// Package store wraps the whatsmeow SQL store container.
//
// Pure-Go SQLite via `modernc.org/sqlite` is used so we don't need cgo
// (keep build portable). modernc registers itself under the name
// `"sqlite"`, but whatsmeow's sqlstore hard-codes `"sqlite3"`. We
// register a proxy driver named `"sqlite3"` that delegates to the
// real modernc driver so `sqlstore.New(ctx, "sqlite3", ...)` works.
package store

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"sync"

	"modernc.org/sqlite"
	waLog "go.mau.fi/whatsmeow/util/log"

	"go.mau.fi/whatsmeow/store/sqlstore"
)

var registerOnce sync.Once

// sqlite3Driver is a database/sql driver that forwards Open to the
// modernc.org/sqlite driver (registered as "sqlite"). Returning a
// *sqlite.Conn (which itself implements the full driver interface)
// means ConnPrepareContext, Tx, etc. all work transparently — the
// embedded *sqlite.Conn handles them.
type sqlite3Driver struct{ underlying driver.Driver }

func (d *sqlite3Driver) Open(name string) (driver.Conn, error) {
	return d.underlying.Open(name)
}

func registerSQLite3() {
	sql.Register("sqlite3", &sqlite3Driver{underlying: &sqlite.Driver{}})
}

func NewContainer(ctx context.Context, path string, log waLog.Logger) (*sqlstore.Container, error) {
	if path == "" {
		return nil, fmt.Errorf("store: empty path")
	}
	registerOnce.Do(registerSQLite3)
	return sqlstore.New(ctx, "sqlite3", "file:"+path+"?_pragma=foreign_keys(1)", log)
}
