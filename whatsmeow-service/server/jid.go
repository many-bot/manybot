package server

import (
	"fmt"
	"strings"

	"go.mau.fi/whatsmeow/types"
)

// parseJID parses a JID string coming from the Node client. The Node side
// already normalized the JID (see /home/syntax/work/active/manybot/dev/src/drivers/jid.ts)
// so we mostly just hand it to whatsmeow's `ParseJID`. We do, however,
// accept bare phone numbers and synthesize the @s.whatsapp.net server
// suffix (whatsmeow accepts it but prefers the explicit form).
func parseJID(s string) (types.JID, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return types.JID{}, fmt.Errorf("parseJID: empty input")
	}
	if !strings.Contains(s, "@") {
		// bare number → @s.whatsapp.net
		s = s + "@s.whatsapp.net"
	}
	return types.ParseJID(s)
}

// formatJID produces the canonical "user@server" form for downstream
// consumers (the Node client expects the wire form, not the LID form).
func formatJID(j types.JID) string {
	if j.IsEmpty() {
		return ""
	}
	return j.String()
}
