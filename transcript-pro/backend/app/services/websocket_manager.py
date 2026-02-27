from collections import defaultdict

from fastapi import WebSocket


class WebSocketManager:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)

    async def connect(self, job_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[job_id].add(websocket)

    def disconnect(self, job_id: str, websocket: WebSocket) -> None:
        if job_id not in self._connections:
            return
        self._connections[job_id].discard(websocket)
        if not self._connections[job_id]:
            self._connections.pop(job_id, None)

    async def broadcast(self, job_id: str, payload: dict) -> None:
        dead_connections: list[WebSocket] = []
        for websocket in self._connections.get(job_id, set()):
            try:
                await websocket.send_json(payload)
            except Exception:
                dead_connections.append(websocket)

        for websocket in dead_connections:
            self.disconnect(job_id, websocket)


ws_manager = WebSocketManager()
