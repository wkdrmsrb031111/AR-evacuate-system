"""Optional, separate app-only server using the same database in read-only mode."""
from pathlib import Path
from fastapi import FastAPI
from server.app_routes import register_app_routes


def create_reader(data_dir: Path | None = None):
    reader = FastAPI(title='AR Evacuate 앱 조회 서버', version='1.0.0')
    register_app_routes(reader, (data_dir or Path(__file__).parent / 'data') / 'evacuate.sqlite3')
    return reader


app = create_reader()
