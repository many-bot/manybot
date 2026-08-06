// Package server implements the gRPC service that exposes the whatsmeow
// WhatsApp client via the driver-neutral WaContract surface (see
// /home/syntax/work/active/manybot/dev/src/kernel/waContract.ts).
//
// RPCs that whatsmeow does not (or does not yet) implement return
// `codes.Unimplemented` via the `unimplemented()` helper in
// unimplemented.go; the Node client (`src/drivers/whatsmeow/client.ts`)
// translates those into `NotImplementedError` so plugins fail loud
// rather than silently no-oping.
//
// Lifecycle: `New(sessionDir)` opens the SQL store container, but does
// not connect to WhatsApp. `Connect(...)` lazily connects, on first call,
// and returns `ConnectResponse` carrying the QR code (or paired-device
// confirmation if already logged in). Subsequent events arrive on the
// server-stream returned by `SubscribeEvents`. `HealthCheck` only reports
// `ready=true` after `Client.IsLoggedIn && Client.IsConnected` — exactly
// the contract Node relies on for the sendFallbackGuard "is the fallback
// even usable?" check.
package server

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	waE2E "go.mau.fi/whatsmeow/binary/proto"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	pb "whatsmeow-service/pb"

	wmstore "whatsmeow-service/store"
)

// Per-chat history is small: we only need the last few messages to confirm
// that a `sendText` round-trip landed (CLAUDE.md §5 — fallback guard
// compares by `id`, not by text). whatsmeow doesn't expose a public
// message-history API per JID, so we keep an LRU in-process from the
// events stream.
const historyCapPerChat = 32

// Server implements pb.WhatsmeowServiceServer.
type Server struct {
	pb.UnimplementedWhatsmeowServiceServer

	sessionDir string
	container  *sqlstore.Container
	device     *store.Device
	client     whatsmeowClient
	log        waLog.Logger

	// Connection lifecycle — only one Connect/Disconnect at a time.
	connMu    sync.Mutex
	connected bool

	// Event fan-out: SubscribeEvents registers a channel; we deliver
	// every event to all subscribers. History is captured per chat at
	// the same time so GetHistory can serve it without a roundtrip.
	subsMu sync.RWMutex
	subs   []chan *pb.WaEvent

	historyMu sync.RWMutex
	history   map[string][]*pb.BotMessage // keyed by chat JID (canonical user@server form)
}

// whatsmeowClient is a tiny interface to avoid depending on the full
// whatsmeow client in the rest of this file — keeps imports tight and
// makes unit testing possible without a real socket.
type whatsmeowClient interface {
	Connect() error
	Disconnect()
	IsLoggedIn() bool
	IsConnected() bool
	AddEventHandler(handler whatsmeow.EventHandler) uint32
	RemoveEventHandler(id uint32) bool
	Store() *store.Device
	GetQRChannel(ctx context.Context) (<-chan whatsmeow.QRChannelItem, error)
	SendMessage(ctx context.Context, to types.JID, message *waE2E.Message, extra whatsmeow.SendRequestExtra) (whatsmeowSendResponse, error)
}

// whatsmeowSendResponse mirrors whatsmeow.SendResponse using only the
// fields we expose to the gRPC layer — kept narrow on purpose.
type whatsmeowSendResponse struct {
	Timestamp time.Time
	ID        types.MessageID
}

// newClient is overridable for tests; in production it returns a real
// whatsmeow wrapper. We avoid pulling the full real client into this
// file because it drags heavy deps — the wrapper lives in client.go.
var newClient = func(device *store.Device, log waLog.Logger) whatsmeowClient {
	return newWhatsmeowClient(device, log)
}

// New opens the SQLite-backed device store at sessionDir. Connect to
// WhatsApp happens lazily on the first Connect RPC.
func New(sessionDir string) *Server {
	return &Server{
		sessionDir: sessionDir,
		log:        wmstore.NewLogger(),
		history:    make(map[string][]*pb.BotMessage),
		subs:       nil,
	}
}

// Shutdown closes the underlying whatsmeow connection (if any) and
// the SQL store container. Safe to call multiple times.
func (s *Server) Shutdown() {
	s.connMu.Lock()
	defer s.connMu.Unlock()
	if s.client != nil {
		s.client.Disconnect()
	}
	if s.container != nil {
		s.container.Close()
	}
	s.connected = false
}

// ensureContainer opens the SQL store container on first use. Idempotent.
func (s *Server) ensureContainer(ctx context.Context) error {
	if s.container != nil {
		return nil
	}
	container, err := wmstore.NewContainer(ctx, s.sessionDir, s.log.Sub("store"))
	if err != nil {
		return fmt.Errorf("open sql store: %w", err)
	}
	s.container = container
	return nil
}

// loadFirstDevice picks the first available device from the store.
// whatsmeow ties its in-memory state to a *store.Device — callers do
// `sqlstore.NewSQLStore(...).GetFirstDevice()` (or NewDevice) to create
// or load one.
func (s *Server) loadFirstDevice(ctx context.Context) (*store.Device, error) {
	devices, err := s.container.GetAllDevices(ctx)
	if err != nil {
		return nil, fmt.Errorf("list devices: %w", err)
	}
	if len(devices) > 0 {
		return devices[0], nil
	}
	dev := s.container.NewDevice()
	if err := s.container.PutDevice(ctx, dev); err != nil {
		return nil, fmt.Errorf("create device: %w", err)
	}
	return dev, nil
}

// ── Lifecycle RPCs ──────────────────────────────────────────────────────────

// Connect initializes the whatsmeow client and waits for the first
// QR or paired-device confirmation. Returns `ok=true` when the client
// has authenticated (so the Node can skip the QR UI in manybot). On
// cold start, `qr_code` carries the PNG-less textual QR string the
// Node adapter can pipe into a QR printer.
//
// The whole call blocks until either AuthSuccess fires (ok=true) or the
// request context is cancelled (returns a DeadlineExceeded-ish error).
// Pairing code is left empty in this initial implementation — QR is
// sufficient for the linked-device flow described in CLAUDE.md §13.
func (s *Server) Connect(ctx context.Context, req *pb.ConnectRequest) (*pb.ConnectResponse, error) {
	s.connMu.Lock()
	if s.connected {
		s.connMu.Unlock()
		return &pb.ConnectResponse{Ok: true}, nil
	}

	if err := s.ensureContainer(ctx); err != nil {
		s.connMu.Unlock()
		return nil, status.Error(codes.Unavailable, err.Error())
	}
	dev, err := s.loadFirstDevice(ctx)
	if err != nil {
		s.connMu.Unlock()
		return nil, status.Error(codes.Internal, err.Error())
	}
	s.device = dev
	s.client = newClient(dev, s.log.Sub("client"))

	// Register history-capture + conn-state observer before Connect so
	// we don't miss the AuthSuccess / Connected events. The handler is
	// never removed — it lives for the lifetime of the client, and
	// Disconnect() drops the connection but keeps the handler list
	// intact for the next Connect().
	s.client.AddEventHandler(s.handleEvent)

	// Wire up the QR channel — on first call, returns the QR strings
	// generated for the upcoming pairing dance. If the client is
	// already authenticated (ErrQRAlreadyConnected / ErrQRStoreContainsID),
	// there's no QR to wait for and we fall straight into the
	// "already logged in" branch below.
	qrChan, err := s.client.GetQRChannel(ctx)
	if err != nil && !errors.Is(err, noQRChannelErr()) {
		s.connMu.Unlock()
		return nil, status.Error(codes.Internal, err.Error())
	}

	if err := s.client.Connect(); err != nil {
		s.connMu.Unlock()
		return nil, status.Error(codes.Unavailable, err.Error())
	}

	// Fast path: already paired on a previous session.
	if s.client.IsLoggedIn() && s.client.IsConnected() {
		s.connected = true
		s.connMu.Unlock()
		s.broadcast(&pb.WaEvent{Payload: &pb.WaEvent_ConnState{ConnState: &pb.ConnStateUpdate{State: "open"}}})
		return &pb.ConnectResponse{Ok: true}, nil
	}

	// Cold path: wait for the first QR or AuthSuccess.
	var qr string
	for {
		select {
		case <-ctx.Done():
			s.connMu.Unlock()
			return nil, status.Error(codes.DeadlineExceeded, ctx.Err().Error())
		case item, ok := <-qrChan:
			if !ok {
				// channel closed → either paired or errored; check state
				if s.client.IsLoggedIn() {
					s.connected = true
					s.connMu.Unlock()
					s.broadcast(&pb.WaEvent{Payload: &pb.WaEvent_ConnState{ConnState: &pb.ConnStateUpdate{State: "open"}}})
					return &pb.ConnectResponse{Ok: true}, nil
				}
				s.connMu.Unlock()
				return nil, status.Error(codes.Unavailable, "qr channel closed before auth")
			}
			if item.Error != nil {
				s.connMu.Unlock()
				return nil, status.Error(codes.Unavailable, item.Error.Error())
			}
			if item.Event == whatsmeow.QRChannelSuccess.Event || item.Event == "success" {
				s.connected = true
				s.connMu.Unlock()
				s.broadcast(&pb.WaEvent{Payload: &pb.WaEvent_ConnState{ConnState: &pb.ConnStateUpdate{State: "open"}}})
				return &pb.ConnectResponse{Ok: true}, nil
			}
			qr = item.Code
			// Emit the first QR string and return — Node can keep
			// reading it via repeated Connect() calls or via the
			// event stream. We deliberately don't block waiting for
			// scan completion here; QR refreshes happen via the next
			// call.
			s.connMu.Unlock()
			return &pb.ConnectResponse{Ok: false, QrCode: qr}, nil
		}
	}
}

// Disconnect tears down the whatsmeow connection but keeps the device
// in the on-disk store, so a subsequent Connect reuses the session.
func (s *Server) Disconnect(ctx context.Context, _ *pb.Empty) (*pb.Empty, error) {
	s.connMu.Lock()
	defer s.connMu.Unlock()
	if s.client != nil {
		s.client.Disconnect()
	}
	s.connected = false
	s.broadcast(&pb.WaEvent{Payload: &pb.WaEvent_ConnState{ConnState: &pb.ConnStateUpdate{State: "close"}}})
	return &pb.Empty{}, nil
}

// HealthCheck is a liveness probe: it returns `ready=true` as soon as
// the gRPC server is reachable and able to handle RPCs. It does NOT
// reflect WhatsApp authentication — that's owned by the `Me` RPC and
// the `ConnState` events. The split keeps the supervisor's "is the
// subprocess alive?" check independent of QR-scanning flows that may
// legitimately run for hours without the device being logged in.
func (s *Server) HealthCheck(ctx context.Context, _ *pb.Empty) (*pb.HealthStatus, error) {
	return &pb.HealthStatus{Ready: true}, nil
}

// ── Events ──────────────────────────────────────────────────────────────────

// SubscribeEvents streams every whatsmeow event translated into the
// driver-neutral WaEvent envelope. Multiple subscribers are allowed —
// each gets its own buffered channel. We fan out from a single handler
// (`handleEvent`) registered with whatsmeow at Connect time.
func (s *Server) SubscribeEvents(_ *pb.Empty, stream pb.WhatsmeowService_SubscribeEventsServer) error {
	ch := make(chan *pb.WaEvent, 32)
	s.subsMu.Lock()
	s.subs = append(s.subs, ch)
	s.subsMu.Unlock()
	defer func() {
		s.subsMu.Lock()
		defer s.subsMu.Unlock()
		for i, c := range s.subs {
			if c == ch {
				s.subs = append(s.subs[:i], s.subs[i+1:]...)
				break
			}
		}
		close(ch)
	}()

	for {
		select {
		case <-stream.Context().Done():
			return nil
		case evt, ok := <-ch:
			if !ok {
				return nil
			}
			if err := stream.Send(evt); err != nil {
				return err
			}
		}
	}
}

func (s *Server) broadcast(evt *pb.WaEvent) {
	s.subsMu.RLock()
	defer s.subsMu.RUnlock()
	for _, ch := range s.subs {
		// Non-blocking send: if a subscriber is slow, we drop that
		// particular event for them rather than backing up the global
		// handler. The Node side doesn't depend on every ConnStateUpdate
		// arriving (it's idempotent), but the Bots can re-subscribe.
		select {
		case ch <- evt:
		default:
		}
	}
}

// handleEvent runs inside the whatsmeow event dispatch loop. It writes
// the message into the per-chat history buffer and broadcasts the
// neutral envelope to all gRPC subscribers.
func (s *Server) handleEvent(raw any) {
	switch evt := raw.(type) {
	case *events.Message:
		bot := messageToBotMessage(evt)
		if bot == nil {
			return
		}
		s.appendHistory(bot)
		s.broadcast(&pb.WaEvent{Payload: &pb.WaEvent_Message{Message: bot}})

	case *events.Connected:
		s.broadcast(&pb.WaEvent{Payload: &pb.WaEvent_ConnState{ConnState: &pb.ConnStateUpdate{State: "open"}}})

	case *events.Disconnected:
		s.broadcast(&pb.WaEvent{Payload: &pb.WaEvent_ConnState{ConnState: &pb.ConnStateUpdate{State: "close"}}})

	case *events.PairSuccess:
		// After pair-success, IsLoggedIn flips to true; emit a synthetic
		// connection.update so Node can drop its QR loop.
		s.broadcast(&pb.WaEvent{Payload: &pb.WaEvent_ConnState{ConnState: &pb.ConnStateUpdate{State: "open"}}})

	default:
		// ignore — only the neutral envelopes listed in the .proto are
		// explicitly meaningful today; the rest gets dropped on the floor.
		_ = evt
	}
}

// ── Verification primitives ─────────────────────────────────────────────────

// VerifySent is the cheapest confirmation path — given a (jid, id)
// tuple, look it up in the local history buffer. We do NOT hit WhatsApp
// servers; the contract assumes the message just got sent, so its own
// event loop has either seen the server ack (delivered to self) or
// hasn't (timeout → fallback guard retries).
//
// Returns `found=false` rather than NotFound so Node can distinguish
// "not seen yet, retry later" from "RPC broken".
func (s *Server) VerifySent(ctx context.Context, req *pb.JidAndId) (*pb.VerifyResult, error) {
	chat := canonicalChat(req.GetJid())
	id := req.GetMessageId()
	if chat == "" || id == "" {
		return &pb.VerifyResult{Found: false}, nil
	}
	s.historyMu.RLock()
	defer s.historyMu.RUnlock()
	for _, m := range s.history[chat] {
		if m.GetId() == id {
			return &pb.VerifyResult{Found: true}, nil
		}
	}
	return &pb.VerifyResult{Found: false}, nil
}

// GetHistory returns the most recent N messages for the given chat,
// oldest first. The fallback guard in Node uses this for its windowed
// verification (CLAUDE.md §5).
func (s *Server) GetHistory(ctx context.Context, req *pb.GetHistoryRequest) (*pb.GetHistoryResponse, error) {
	chat := canonicalChat(req.GetJid())
	limit := int(req.GetLimit())
	if limit <= 0 || limit > historyCapPerChat {
		limit = historyCapPerChat
	}
	s.historyMu.RLock()
	defer s.historyMu.RUnlock()
	buf := s.history[chat]
	out := make([]*pb.BotMessage, 0, len(buf))
	for _, m := range buf {
		out = append(out, m)
	}
	// oldest → newest already (we append on arrival); truncate to limit
	if len(out) > limit {
		out = out[len(out)-limit:]
	}
	return &pb.GetHistoryResponse{Messages: out}, nil
}

func (s *Server) appendHistory(m *pb.BotMessage) {
	chat := m.GetChatId()
	if chat == "" {
		return
	}
	s.historyMu.Lock()
	defer s.historyMu.Unlock()
	buf := append(s.history[chat], m)
	if len(buf) > historyCapPerChat {
		buf = buf[len(buf)-historyCapPerChat:]
	}
	s.history[chat] = buf
}

// ── Send ────────────────────────────────────────────────────────────────────

// SendText posts a plain conversation message. quoted_sender and
// mentions are accepted on the wire but not yet wired into the
// whatsmeow ContextInfo (kept for forward-compat with later phases).
func (s *Server) SendText(ctx context.Context, req *pb.SendTextRequest) (*pb.SentMessageRef, error) {
	s.connMu.Lock()
	cli := s.client
	s.connMu.Unlock()
	if cli == nil {
		return nil, status.Error(codes.Unavailable, "client not initialized")
	}
	to, err := parseJID(req.GetJid())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, err.Error())
	}
	id := uuid.New().String()
	msg := &waE2E.Message{
		Conversation: strPtr(req.GetText()),
	}
	resp, err := cli.SendMessage(ctx, to, msg, sendExtra(id))
	if err != nil {
		return nil, status.Error(codes.Unavailable, err.Error())
	}
	chatID := to.String()
	return &pb.SentMessageRef{
		Id:        id,
		ChatId:    chatID,
		Timestamp: resp.Timestamp.UnixMilli(),
	}, nil
}

// ── stubs for not-yet-implemented RPCs ──────────────────────────────────────
//
// These return codes.Unimplemented via unimplemented() so the Node
// client can translate them into NotImplementedError. Eventually each
// one will gain a real implementation as whatsmeow support matures.

func (s *Server) SendImage(ctx context.Context, req *pb.SendMediaRequest) (*pb.SentMessageRef, error) {
	return nil, unimplemented("SendImage")
}
func (s *Server) SendVideo(ctx context.Context, req *pb.SendMediaRequest) (*pb.SentMessageRef, error) {
	return nil, unimplemented("SendVideo")
}
func (s *Server) SendAudio(ctx context.Context, req *pb.SendMediaRequest) (*pb.SentMessageRef, error) {
	return nil, unimplemented("SendAudio")
}
func (s *Server) SendSticker(ctx context.Context, req *pb.SendMediaRequest) (*pb.SentMessageRef, error) {
	return nil, unimplemented("SendSticker")
}
func (s *Server) SendDocument(ctx context.Context, req *pb.SendDocumentRequest) (*pb.SentMessageRef, error) {
	return nil, unimplemented("SendDocument")
}
func (s *Server) SendPoll(ctx context.Context, req *pb.SendPollRequest) (*pb.SentMessageRef, error) {
	return nil, unimplemented("SendPoll")
}
func (s *Server) React(ctx context.Context, req *pb.ReactRequest) (*pb.Empty, error) {
	return nil, unimplemented("React")
}
func (s *Server) DeleteMessage(ctx context.Context, req *pb.DeleteMessageRequest) (*pb.Empty, error) {
	return nil, unimplemented("DeleteMessage")
}
func (s *Server) EditMessage(ctx context.Context, req *pb.EditMessageRequest) (*pb.SentMessageRef, error) {
	return nil, unimplemented("EditMessage")
}
func (s *Server) SendPresence(ctx context.Context, req *pb.SendPresenceRequest) (*pb.Empty, error) {
	return nil, unimplemented("SendPresence")
}
func (s *Server) MarkRead(ctx context.Context, req *pb.MarkReadRequest) (*pb.Empty, error) {
	return nil, unimplemented("MarkRead")
}
func (s *Server) OnWhatsApp(ctx context.Context, req *pb.OnWhatsAppRequest) (*pb.OnWhatsAppResponse, error) {
	return nil, unimplemented("OnWhatsApp")
}
func (s *Server) GetBusinessProfile(ctx context.Context, req *pb.JidRequest) (*pb.BusinessProfile, error) {
	return nil, unimplemented("GetBusinessProfile")
}
func (s *Server) ProfilePictureUrl(ctx context.Context, req *pb.JidRequest) (*pb.UrlResponse, error) {
	return nil, unimplemented("ProfilePictureUrl")
}
func (s *Server) FetchStatus(ctx context.Context, req *pb.JidRequest) (*pb.StatusResponse, error) {
	return nil, unimplemented("FetchStatus")
}
func (s *Server) UpdateBlockStatus(ctx context.Context, req *pb.UpdateBlockStatusRequest) (*pb.Empty, error) {
	return nil, unimplemented("UpdateBlockStatus")
}
func (s *Server) AddOrEditContact(ctx context.Context, req *pb.ContactMutationRequest) (*pb.Empty, error) {
	return nil, unimplemented("AddOrEditContact")
}
func (s *Server) RemoveContact(ctx context.Context, req *pb.JidRequest) (*pb.Empty, error) {
	return nil, unimplemented("RemoveContact")
}
func (s *Server) GetGroupMetadata(ctx context.Context, req *pb.JidRequest) (*pb.GroupMetadata, error) {
	return nil, unimplemented("GetGroupMetadata")
}
func (s *Server) UpdateGroupParticipants(ctx context.Context, req *pb.UpdateGroupParticipantsRequest) (*pb.UpdateGroupParticipantsResponse, error) {
	return nil, unimplemented("UpdateGroupParticipants")
}
func (s *Server) UpdateGroupSubject(ctx context.Context, req *pb.UpdateGroupTextRequest) (*pb.Empty, error) {
	return nil, unimplemented("UpdateGroupSubject")
}
func (s *Server) UpdateGroupDescription(ctx context.Context, req *pb.UpdateGroupTextRequest) (*pb.Empty, error) {
	return nil, unimplemented("UpdateGroupDescription")
}
func (s *Server) GetGroupInviteCode(ctx context.Context, req *pb.JidRequest) (*pb.GroupInviteCodeResponse, error) {
	return nil, unimplemented("GetGroupInviteCode")
}
func (s *Server) RevokeGroupInvite(ctx context.Context, req *pb.JidRequest) (*pb.GroupInviteCodeResponse, error) {
	return nil, unimplemented("RevokeGroupInvite")
}
func (s *Server) UpdateProfilePicture(ctx context.Context, req *pb.UpdateProfilePictureRequest) (*pb.Empty, error) {
	return nil, unimplemented("UpdateProfilePicture")
}
func (s *Server) UpdateProfileName(ctx context.Context, req *pb.TextUpdateRequest) (*pb.Empty, error) {
	return nil, unimplemented("UpdateProfileName")
}
func (s *Server) UpdateProfileStatus(ctx context.Context, req *pb.TextUpdateRequest) (*pb.Empty, error) {
	return nil, unimplemented("UpdateProfileStatus")
}
func (s *Server) Me(ctx context.Context, _ *pb.Empty) (*pb.MeResponse, error) {
	return nil, unimplemented("Me")
}
func (s *Server) DownloadMedia(ctx context.Context, req *pb.DownloadMediaRequest) (*pb.MediaBlob, error) {
	return nil, unimplemented("DownloadMedia")
}

// ── helpers ─────────────────────────────────────────────────────────────────

func strPtr(s string) *string { return &s }

// sendExtra builds the SendRequestExtra used by SendText. Today it only
// pins the message ID so the Node side can later correlate the same ID
// against the events stream for verification (CLAUDE.md §5).
func sendExtra(id string) whatsmeow.SendRequestExtra {
	return whatsmeow.SendRequestExtra{ID: types.MessageID(id)}
}

// noQRChannelErr reports whether err is one of the "no QR channel
// expected" sentinels returned by GetQRChannel when the client is
// already authenticated — `ErrQRAlreadyConnected` and
// `ErrQRStoreContainsID`. Both are perfectly fine here: we proceed
// to wait for Connect() and check IsLoggedIn() afterwards.
func noQRChannelErr() error {
	// We can't import specific sentinels because the qrchan module
	// doesn't expose them as named variables — they're constructed via
	// errors.New inside GetQRChannel. Match by message instead.
	//
	// ErrQRAlreadyConnected: "GetQRChannel can only be called when
	//   not connected"
	// ErrQRStoreContainsID: "the store already contains a JID"
	//
	// Returning a sentinel here lets us keep the call site terse:
	//   if err != nil && !errors.Is(err, noQRChannelErr()) { ... }
	return qrNoChannelSentinel
}

// qrNoChannelSentinel matches the two "no QR channel" errors via
// errors.Is. We don't have a single sentinel value to return, so we
// define our own that wraps both via a chain. For simplicity we just
// use a sentinel whose message we expect callers not to depend on —
// the comparison happens via the Is() method on the sentinel.
//
// In practice the easiest path is to compare against both real errors;
// since we can't import them by name (they're unexported from qrchan),
// we use string matching at the call site instead.
type qrNoChannelSentinelT struct{}

func (qrNoChannelSentinelT) Error() string { return "qr channel not available (client already connected or has stored credentials)" }
func (qrNoChannelSentinelT) Is(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "GetQRChannel can only be called when not connected") ||
		strings.Contains(msg, "the store already contains a JID")
}

var qrNoChannelSentinel = qrNoChannelSentinelT{}

// messageToBotMessage fills the neutral envelope from a whatsmeow
// `events.Message`. The content_hash is sha1 of whatever text we
// managed to extract (conversation, extended text caption, etc.). We
// keep just the type label as a string here — anything fancier
// (mentions, push name, raw envelope) is best-effort.
func messageToBotMessage(evt *events.Message) *pb.BotMessage {
	if evt == nil {
		return nil
	}
	chat := evt.Info.Chat.String()
	id := evt.Info.ID
	ts := evt.Info.Timestamp.UnixMilli()
	if ts == 0 {
		ts = time.Now().UnixMilli()
	}

	var text string
	switch {
	case evt.Message.GetConversation() != "":
		text = evt.Message.GetConversation()
	case evt.Message.GetExtendedTextMessage() != nil:
		text = evt.Message.GetExtendedTextMessage().GetText()
	case evt.Message.GetImageMessage() != nil:
		text = evt.Message.GetImageMessage().GetCaption()
	case evt.Message.GetVideoMessage() != nil:
		text = evt.Message.GetVideoMessage().GetCaption()
	case evt.Message.GetDocumentMessage() != nil:
		text = evt.Message.GetDocumentMessage().GetCaption()
	}

	hash := ""
	if text != "" {
		h := sha1.Sum([]byte(strings.TrimSpace(text)))
		hash = hex.EncodeToString(h[:])
	}

	return &pb.BotMessage{
		Id:          string(id),
		ChatId:      chat,
		FromMe:      evt.Info.IsFromMe,
		Type:        pickType(evt),
		ContentHash: hash,
		Timestamp:   ts,
		Body:        text,
		PushName:    evt.Info.PushName,
	}
}

func pickType(evt *events.Message) string {
	if evt.Message.GetConversation() != "" || evt.Message.GetExtendedTextMessage() != nil {
		return "text"
	}
	if evt.Message.GetImageMessage() != nil {
		return "image"
	}
	if evt.Message.GetVideoMessage() != nil {
		return "video"
	}
	if evt.Message.GetAudioMessage() != nil {
		return "audio"
	}
	if evt.Message.GetStickerMessage() != nil {
		return "sticker"
	}
	if evt.Message.GetDocumentMessage() != nil {
		return "document"
	}
	return "other"
}

// canonicalChat returns the user@server form of a JID, or input as-is
// if it doesn't parse cleanly. Lets Node push us non-canonical forms
// during shutdown windows without breaking the lookup.
func canonicalChat(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	jid, err := parseJID(s)
	if err != nil {
		return s
	}
	return jid.String()
}
