// Package store wraps the whatsmeow SQL store container.
//
// Pure-Go SQLite via `modernc.org/sqlite` is used so we don't need cgo
// (CLAUDE.md §17 — keep build portable).
package store

import (
	"context"
	"fmt"

	_ "modernc.org/sqlite"
	waLog "go.mau.fi/whatsmeow/util/log"

	"go.mau.fi/whatsmeow/store/sqlstore"
)

// NewContainer opens (or creates) the whatsmeow device-store SQLite
// database at the given path and returns the container ready for
// `sqlstore.NewSQLStore(...)` use.
//
// `path` may be a file path. The function also accepts a `file:...?...
// query` form so callers can tune journal/WAL pragmas in the future —
// for now we keep the surface small and let `modernc.org/sqlite` apply
// sensible defaults.
func NewContainer(ctx context.Context, path string, log waLog.Logger) (*sqlstore.Container, error) {
	if path == "" {
		return nil, fmt.Errorf("store: empty path")
	}
	return sqlstore.New(ctx, "sqlite3", "file:"+path+"?_pragma=foreign_keys(1)", log)
}
