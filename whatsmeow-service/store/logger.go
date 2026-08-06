package store

import (
	"os"

	"github.com/rs/zerolog"
	waLog "go.mau.fi/whatsmeow/util/log"
)

// NewLogger returns a zerolog-backed waLog.Logger writing to stderr, prefixed
// with the "whatsmeow/store" module. Used by NewContainer so whatsmeow logs
// are easy to spot in ManyBot's combined stdout.
func NewLogger() waLog.Logger {
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	return waLog.Zerolog(zerolog.New(os.Stderr).With().Timestamp().Logger())
}
