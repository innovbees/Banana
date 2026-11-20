// BananaCAD portable launcher.
//
// One self-contained executable: the web app (../cad) is embedded, served on
// 127.0.0.1 only, and opened in a chromeless app window (Microsoft Edge or
// Google Chrome in --app mode, with BananaCAD's own browser profile). Closing the
// window quits the launcher. No installation, admin rights or internet needed.
package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"time"
)

//go:embed all:app
var appFiles embed.FS

const preferredPort = 47231 // fixed so the page origin (and its autosave) stays the same

var lastPing atomic.Int64

func dataDir() string {
	base, err := os.UserConfigDir() // %AppData% on Windows
	if err != nil {
		base = os.TempDir()
	}
	d := filepath.Join(base, "BananaCAD")
	_ = os.MkdirAll(d, 0o755)
	return d
}

func handler() http.Handler {
	sub, err := fs.Sub(appFiles, "app")
	if err != nil {
		log.Fatal(err)
	}
	files := http.FileServer(http.FS(sub))
	mux := http.NewServeMux()
	mux.HandleFunc("/__bananacad", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "bananacad") })
	mux.HandleFunc("/__ping", func(w http.ResponseWriter, r *http.Request) {
		lastPing.Store(time.Now().Unix())
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if ct := mime.TypeByExtension(filepath.Ext(r.URL.Path)); ct != "" {
			w.Header().Set("Content-Type", ct)
		}
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		files.ServeHTTP(w, r)
	})
	return mux
}

// alreadyRunning reports whether another BananaCAD launcher serves the preferred port.
func alreadyRunning(port int) bool {
	c := http.Client{Timeout: 700 * time.Millisecond}
	resp, err := c.Get(fmt.Sprintf("http://127.0.0.1:%d/__bananacad", port))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	b := make([]byte, 16)
	n, _ := resp.Body.Read(b)
	return string(b[:n]) == "bananacad"
}

func findBrowser() string {
	var cands []string
	switch runtime.GOOS {
	case "windows":
		for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles", "LocalAppData"} {
			if p := os.Getenv(env); p != "" {
				cands = append(cands,
					filepath.Join(p, `Microsoft\Edge\Application\msedge.exe`),
					filepath.Join(p, `Google\Chrome\Application\chrome.exe`),
					filepath.Join(p, `Chromium\Application\chrome.exe`),
					filepath.Join(p, `BraveSoftware\Brave-Browser\Application\brave.exe`))
			}
		}
	case "darwin":
		cands = []string{
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
		}
	default:
		for _, n := range []string{"microsoft-edge", "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "brave-browser"} {
			if p, err := exec.LookPath(n); err == nil {
				cands = append(cands, p)
			}
		}
	}
	for _, c := range cands {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	return ""
}

func openDefaultBrowser(url string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		return exec.Command("open", url).Start()
	default:
		return exec.Command("xdg-open", url).Start()
	}
}

func main() {
	noBrowser := flag.Bool("no-browser", false, "only run the local server (for testing)")
	portFlag := flag.Int("port", preferredPort, "local port")
	flag.Parse()

	dir := dataDir()
	if lf, err := os.OpenFile(filepath.Join(dir, "launcher.log"), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644); err == nil {
		log.SetOutput(lf)
		defer lf.Close()
	}

	port := *portFlag
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		if alreadyRunning(port) && !*noBrowser {
			// Another copy is running: just open one more window on it.
			url := fmt.Sprintf("http://127.0.0.1:%d/", port)
			if b := findBrowser(); b != "" {
				_ = exec.Command(b, "--app="+url, "--user-data-dir="+filepath.Join(dir, "browser")).Start()
			} else {
				_ = openDefaultBrowser(url)
			}
			return
		}
		ln, err = net.Listen("tcp", "127.0.0.1:0") // port taken by something else
		if err != nil {
			log.Fatal(err)
		}
		port = ln.Addr().(*net.TCPAddr).Port
	}
	url := fmt.Sprintf("http://127.0.0.1:%d/", port)
	log.Printf("serving BananaCAD on %s", url)
	srv := &http.Server{Handler: handler(), ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = srv.Serve(ln) }()

	if *noBrowser {
		fmt.Println("BananaCAD server running at", url)
		select {}
	}

	if b := findBrowser(); b != "" {
		args := []string{
			"--app=" + url,
			"--user-data-dir=" + filepath.Join(dir, "browser"),
			"--no-first-run", "--no-default-browser-check",
			"--window-size=1440,920",
		}
		log.Printf("starting %s", b)
		cmd := exec.Command(b, args...)
		if err := cmd.Start(); err == nil {
			_ = cmd.Wait() // the window was closed
			// A browser that hands off to an existing process exits at once; keep serving
			// while the page is still pinging.
			waitForIdle(15 * time.Second)
			return
		} else {
			log.Printf("browser failed: %v", err)
		}
	}
	// No Chromium-based browser: use the default one and quit when the page goes away.
	if err := openDefaultBrowser(url); err != nil {
		log.Printf("cannot open a browser: %v", err)
	}
	waitForIdle(30 * time.Second)
}

// waitForIdle returns once the app has not pinged for `idle` (it pings every 5 s while open).
func waitForIdle(idle time.Duration) {
	start := time.Now()
	for {
		time.Sleep(2 * time.Second)
		lp := lastPing.Load()
		if lp == 0 {
			if time.Since(start) > idle {
				return
			}
			continue
		}
		if time.Since(time.Unix(lp, 0)) > idle {
			return
		}
	}
}
