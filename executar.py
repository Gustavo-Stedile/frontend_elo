from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import webbrowser


ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = 5173
URL = f"http://localhost:{PORT}"


def main():
    handler = partial(SimpleHTTPRequestHandler, directory=str(ROOT))

    try:
        server = ThreadingHTTPServer((HOST, PORT), handler)
    except OSError as error:
        raise SystemExit(
            f"Nao foi possivel iniciar o servidor em {URL}. "
            "Verifique se a porta 5173 ja esta em uso."
        ) from error

    print(f"Frontend disponivel em {URL} (Ctrl+C para encerrar).")
    webbrowser.open(URL)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor encerrado.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
