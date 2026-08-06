// Package server implements the gRPC service that exposes the whatsmeow
// WhatsApp client via the driver-neutral `WaContract` surface (see
// /home/syntax/work/active/manybot/dev/src/kernel/waContract.ts).
//
// RPCs that whatsmeow does not (or does not yet) implement return
// `codes.Unimplemented` via the `unimplemented()` helper below; the Node
// client (`src/drivers/whatsmeow/client.ts`) translates those into
// `NotImplementedError` so plugins fail loud rather than silently no-op.
package server

import (
	"fmt"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// unimplemented returns a gRPC `codes.Unimplemented` error tagged with the
// RPC method name. Keeps the call sites terse and lets the client side
// translate uniformly.
func unimplemented(method string) error {
	return status.Error(codes.Unimplemented, fmt.Sprintf("whatsmeow-service: %s not implemented yet", method))
}
