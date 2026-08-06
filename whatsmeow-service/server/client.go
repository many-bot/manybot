// Package server - thin wrapper around the real whatsmeow.Client that
// implements the local `whatsmeowClient` interface declared in server.go.
// Keeps the rest of this package free of the heavy whatsmeow.Client
// concrete type and makes the boundary unit-testable.
package server

import (
	"context"

	waE2E "go.mau.fi/whatsmeow/binary/proto"
	"go.mau.fi/whatsmeow/store"
	waLog "go.mau.fi/whatsmeow/util/log"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
)

// whatsmeowRealClient is the production implementation. It just forwards
// to the underlying *whatsmeow.Client.
type whatsmeowRealClient struct {
	cli *whatsmeow.Client
}

func newWhatsmeowClient(dev *store.Device, log waLog.Logger) whatsmeowClient {
	return &whatsmeowRealClient{cli: whatsmeow.NewClient(dev, log)}
}

func (w *whatsmeowRealClient) Connect() error    { return w.cli.Connect() }
func (w *whatsmeowRealClient) Disconnect()       { w.cli.Disconnect() }
func (w *whatsmeowRealClient) IsLoggedIn() bool  { return w.cli.IsLoggedIn() }
func (w *whatsmeowRealClient) IsConnected() bool { return w.cli.IsConnected() }
func (w *whatsmeowRealClient) AddEventHandler(h whatsmeow.EventHandler) uint32 {
	return w.cli.AddEventHandler(h)
}
func (w *whatsmeowRealClient) RemoveEventHandler(id uint32) bool {
	return w.cli.RemoveEventHandler(id)
}
func (w *whatsmeowRealClient) Store() *store.Device { return w.cli.Store }
func (w *whatsmeowRealClient) GetQRChannel(ctx context.Context) (<-chan whatsmeow.QRChannelItem, error) {
	return w.cli.GetQRChannel(ctx)
}
func (w *whatsmeowRealClient) SendMessage(ctx context.Context, to types.JID, msg *waE2E.Message, extra whatsmeow.SendRequestExtra) (whatsmeowSendResponse, error) {
	resp, err := w.cli.SendMessage(ctx, to, msg, extra)
	if err != nil {
		return whatsmeowSendResponse{}, err
	}
	return whatsmeowSendResponse{Timestamp: resp.Timestamp, ID: resp.ID}, nil
}
