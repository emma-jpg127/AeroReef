"""Pruebas automáticas: ejecútalas con `python -m pytest`."""
import os
import re
import tempfile

os.environ["SESSION_SECRET"] = "x" * 40
os.environ["DB_PATH"] = os.path.join(tempfile.mkdtemp(), "test.db")

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402

PASSWORD = "contraseña-larga-1"


def token(html):
    return re.search(r'name="csrf" (?:value|content)="([^"]+)"', html).group(1)


def new_user(email):
    c = TestClient(app)
    r = c.post("/registro", data={"email": email, "password": PASSWORD,
                                  "csrf": token(c.get("/registro").text)}, follow_redirects=False)
    assert r.status_code == 303
    return c


def test_health():
    assert TestClient(app).get("/health").json() == {"status": "ok"}


def test_post_sin_csrf_es_rechazado():
    r = TestClient(app).post("/login", data={"email": "a@b.test", "password": PASSWORD})
    assert r.status_code == 403


def test_login_incorrecto_y_correcto():
    new_user("login@lab.test")
    c = TestClient(app)
    tok = token(c.get("/login").text)
    assert c.post("/login", data={"email": "login@lab.test", "password": "incorrecta-123", "csrf": tok}).status_code == 401
    r = c.post("/login", data={"email": "login@lab.test", "password": PASSWORD, "csrf": tok}, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/panel"


def test_panel_exige_sesion():
    r = TestClient(app).get("/panel", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/login"


def test_dominio_real_es_rechazado_y_ficticio_aceptado():
    c = new_user("dom@lab.test")
    tok = token(c.get("/panel").text)
    r = c.post("/dominios", data={"nombre": "google.com", "csrf": tok}, follow_redirects=True)
    assert "Dominio no válido" in r.text
    r = c.post("/dominios", data={"nombre": "tienda.example.com", "csrf": tok}, follow_redirects=True)
    assert "tienda.example.com" in r.text and "(simulado)" in r.text


def test_aislamiento_entre_usuarios():
    a, b = new_user("a@lab.test"), new_user("b@lab.test")
    tok_a, tok_b = token(a.get("/panel").text), token(b.get("/panel").text)
    a.post("/dominios", data={"nombre": "secreto-de-a.lab", "csrf": tok_a})
    pez_a = a.post("/api/peces", json={"species": 0, "name": "Solo de A"}, headers={"X-CSRF-Token": tok_a}).json()
    assert "secreto-de-a.lab" in a.get("/panel").text
    assert "secreto-de-a.lab" not in b.get("/panel").text
    assert pez_a["id"] not in [p["id"] for p in b.get("/api/peces").json()]
    assert b.delete(f"/api/peces/{pez_a['id']}", headers={"X-CSRF-Token": tok_b}).status_code == 404
    assert pez_a["id"] in [p["id"] for p in a.get("/api/peces").json()]


def test_nombre_de_pez_con_html_es_rechazado():
    c = new_user("xss@lab.test")
    tok = token(c.get("/panel").text)
    r = c.post("/api/peces", json={"species": 0, "name": "<img src=x onerror=alert(1)>"}, headers={"X-CSRF-Token": tok})
    assert r.status_code == 422


def test_especies_nuevas_y_limite():
    c = new_user("especies@lab.test")
    tok = token(c.get("/panel").text)
    h = {"X-CSRF-Token": tok}
    assert c.post("/api/peces", json={"species": 9, "name": "Hilo"}, headers=h).status_code == 201
    assert c.post("/api/peces", json={"species": 10, "name": "Nadie"}, headers=h).status_code == 422


def test_numero_de_especies_coincide_con_el_js():
    """Si alguien añade una especie en el JS y olvida el servidor (o al revés), esta prueba falla."""
    from pathlib import Path
    from app.main import SPECIES_COUNT
    js = (Path(__file__).parent.parent / "app" / "static" / "aquarium.js").read_text(encoding="utf-8")
    bloque = js.split("const SPECIES = [")[1].split("];")[0]
    assert bloque.count("nombre:") == SPECIES_COUNT


def test_cuenta_nueva_empieza_con_un_acuario_lleno():
    from app.main import DEFAULT_FISH, MAX_FISH
    c = new_user("lleno@lab.test")
    peces = c.get("/api/peces").json()
    assert len(peces) == len(DEFAULT_FISH) >= 15
    assert len(DEFAULT_FISH) < MAX_FISH


def test_estaticos_llevan_version_para_evitar_la_cache():
    """Si cambia style.css o aquarium.js, la URL cambia y el navegador no usa la copia vieja."""
    c = new_user("cache@lab.test")
    html = c.get("/panel").text
    assert re.search(r'/static/style\.css\?v=[0-9a-f]{10}"', html)
    assert re.search(r'/static/aquarium\.js\?v=[0-9a-f]{10}"', html)
