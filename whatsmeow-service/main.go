// Package main boots the whatsmeow gRPC service: a small wrapper around
// `go.mau.fi/whatsmeow` that exposes the driver-neutral `WaContract`
// surface (see /home/syntax/work/active/manybot/dev/src/kernel/waContract.ts)
// as a gRPC server. Node connects over localhost (subprocess pattern,
// see subprocess pattern).
//
// RPCs not implemented against whatsmeow (yet) return codes.Unimplemented —
// the Node client (`src/drivers/whatsmeow/client.ts`) translates them
// into `NotImplementedError` so plugins fail loud rather than silently
// no-oping.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"syscall"

	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"

	"whatsmeow-service/pb"
	"whatsmeow-service/server"
)

func main() {
	var (
		grpcAddr   = flag.String("grpc-addr", "localhost:50051", "gRPC listen address")
		sessionDir = flag.String("session-dir", "./whatsmeow-session.db", "SQLite path for whatsmeow device store")
		showVer    = flag.Bool("version", false, "print version and exit")
	)
	flag.Parse()

	if *showVer {
		fmt.Println("whatsmeow-service dev (whatsmeow pinned, see go.mod)")
		return
	}

	lis, err := net.Listen("tcp", *grpcAddr)
	if err != nil {
		log.Fatalf("[whatsmeow-service] listen %s: %v", *grpcAddr, err)
	}

	srv := server.New(*sessionDir)

	grpcServer := grpc.NewServer()
	pb.RegisterWhatsmeowServiceServer(grpcServer, srv)
	// gRPC reflection helps when debugging with grpcurl during dev.
	reflection.Register(grpcServer)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM, os.Interrupt)
	defer cancel()

	go func() {
		<-ctx.Done()
		log.Printf("[whatsmeow-service] shutdown signal received")
		srv.Shutdown()
		grpcServer.GracefulStop()
	}()

	log.Printf("[whatsmeow-service] listening on %s (session=%s)", *grpcAddr, *sessionDir)
	if err := grpcServer.Serve(lis); err != nil {
		log.Fatalf("[whatsmeow-service] serve: %v", err)
	}
}
