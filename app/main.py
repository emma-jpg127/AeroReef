"""Aero Reef · acuario virtual (aplicación educativa: FastAPI + SQLite).

Piezas principales:
  1. Configuración (la clave de sesión llega por variable de entorno)
  2. Base de datos SQLite
  3. Seguridad: contraseñas, sesiones, CSRF, límite de intentos, cabeceras
  4. Rutas: registro, acceso, panel, dominios, peces, salida
"""
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware

# ---------- 1. Configuración ----------
BASE = Path(__file__).parent
SECRET = os.environ.get("SESSION_SECRET", "")
if len(SECRET) < 32:  # sin clave propia, la app no arranca
    raise RuntimeError("Define SESSION_SECRET (mínimo 32 caracteres) en el archivo .env")
DB_PATH = os.environ.get("DB_PATH", "/data/aeroreef.db")

# Se desactiva la documentación automática para exponer lo mínimo
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
# Cookie de sesión firmada con SESSION_SECRET. En producción habría que usar https_only=True.
app.add_middleware(SessionMiddleware, secret_key=SECRET, session_cookie="cf_session",
                   max_age=2 * 3600, same_site="lax", https_only=False)
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")
templates = Jinja2Templates(directory=BASE / "templates")  # Jinja2 escapa el HTML por defecto


def asset_version() -> str:
    """Huella de los archivos estáticos. Se añade a sus URLs (style.css?v=...) para que el
    navegador descargue la versión nueva tras cada cambio en lugar de usar la de su caché."""
    h = hashlib.sha256()
    for f in sorted((BASE / "static").iterdir()):
        h.update(f.read_bytes())
    return h.hexdigest()[:10]


templates.env.globals["v"] = asset_version()


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; "
        "base-uri 'none'; form-action 'self'")
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


# ---------- 2. Base de datos ----------
@contextmanager
def db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    try:
        yield con
        con.commit()
    finally:
        con.close()


def init_db():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    with db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS users(
            id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, pw_hash TEXT NOT NULL,
            created TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS fish(
            id INTEGER PRIMARY KEY, species INTEGER NOT NULL, name TEXT NOT NULL,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS domains(
            id INTEGER PRIMARY KEY, name TEXT NOT NULL, created TEXT DEFAULT CURRENT_TIMESTAMP,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(user_id, name));
        CREATE TABLE IF NOT EXISTS alerts(
            id INTEGER PRIMARY KEY, severity TEXT NOT NULL, message TEXT NOT NULL,
            created TEXT DEFAULT CURRENT_TIMESTAMP,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            domain_id INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE);
        """)


init_db()


# ---------- 3. Seguridad ----------
def hash_pw(password: str) -> str:
    """Contraseña -> scrypt con sal aleatoria (nunca se guarda en claro)."""
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"{salt.hex()}${digest.hex()}"


def check_pw(password: str, stored: str) -> bool:
    salt, digest = stored.split("$")
    calc = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1)
    return hmac.compare_digest(calc.hex(), digest)


DUMMY_HASH = hash_pw("contraseña-de-relleno")  # para tardar lo mismo si el correo no existe

FAILS: dict[str, list[float]] = {}  # intentos fallidos de acceso (en memoria)


def blocked(key: str) -> bool:
    """Más de 5 fallos en 5 minutos para el mismo correo y origen -> bloqueo temporal."""
    now = time.time()
    FAILS[key] = [t for t in FAILS.get(key, []) if now - t < 300]
    return len(FAILS[key]) >= 5


def csrf_token(request: Request) -> str:
    return request.session.setdefault("csrf", secrets.token_urlsafe(32))


def verify_csrf(request: Request, token: str | None):
    """Todo POST/DELETE debe traer el token CSRF de la sesión."""
    expected = request.session.get("csrf", "")
    if not token or not expected or not hmac.compare_digest(expected.encode(), token.encode()):
        raise HTTPException(403, "Token CSRF no válido")


def start_session(request: Request, uid: int):
    request.session.clear()  # sesión nueva al entrar (evita fijación de sesión)
    request.session["uid"] = uid
    request.session["csrf"] = secrets.token_urlsafe(32)


def current_user(request: Request):
    uid = request.session.get("uid")
    if not uid:
        return None
    with db() as c:
        return c.execute("SELECT id, email FROM users WHERE id = ?", (uid,)).fetchone()


def render(request: Request, name: str, status: int = 200, **ctx):
    ctx.setdefault("user", None)
    return templates.TemplateResponse(request, name, {"csrf": csrf_token(request), **ctx},
                                      status_code=status)


def flash(request: Request, msg: str):
    request.session["flash"] = msg


# ---------- 4. Rutas ----------
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,185}\.[^@\s]{2,}$")
# Solo dominios ficticios: así nadie analiza (ni siquiera por error) dominios reales
DOMAIN_RE = re.compile(r"^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$")
ALLOWED_SUFFIXES = (".test", ".example", ".invalid", ".lab",
                    ".example.com", ".example.org", ".example.net")
# Número de especies del acuario: debe coincidir con la lista SPECIES de static/aquarium.js
SPECIES_COUNT = 10
MAX_FISH = 40
# Peces con los que empieza cada cuenta nueva: (especie, nombre). Cromis y anthias van en banco.
DEFAULT_FISH = [
    (3, "Turquesa"), (3, "Brisa"), (3, "Ola"), (3, "Menta"), (3, "Celeste"), (3, "Aguamar"),
    (7, "Coralina"), (7, "Mandarina"), (7, "Ascua"), (7, "Salmón"), (7, "Aurora"),
    (0, "Nemo"), (0, "Coral"), (1, "Dory"), (2, "Zafiro"), (4, "Bola"), (5, "Melena"),
    (6, "Moro"), (6, "Bandera"), (8, "Limón"), (8, "Sol"), (9, "Pétalo"), (9, "Hilo"),
]
# Alertas SIMULADAS: no se consulta ninguna red; se eligen a partir del nombre del dominio
ALERT_POOL = [
    ("alta", "El certificado TLS caduca en 7 días"),
    ("media", "Falta la cabecera HSTS"),
    ("baja", "El servidor muestra su versión en las respuestas"),
    ("media", "No hay registro SPF configurado"),
    ("alta", "Panel de administración sin segundo factor"),
    ("baja", "La redirección de HTTP a HTTPS es incompleta"),
]


@app.get("/")
def home(request: Request):
    return RedirectResponse("/panel" if current_user(request) else "/login", 303)


@app.get("/health")
def health():
    with db() as c:
        c.execute("SELECT 1")
    return {"status": "ok"}


@app.get("/registro")
def registro_form(request: Request):
    return render(request, "auth.html", modo="registro", titulo="Crear cuenta", action="/registro",
                  alt_url="/login", alt_text="¿Ya tienes cuenta? Inicia sesión")


@app.post("/registro")
def registro(request: Request, email: str = Form(""), password: str = Form(""), csrf: str = Form("")):
    verify_csrf(request, csrf)
    email = email.strip().lower()
    kw = dict(modo="registro", titulo="Crear cuenta", action="/registro",
              alt_url="/login", alt_text="¿Ya tienes cuenta? Inicia sesión")
    if not EMAIL_RE.match(email) or not 10 <= len(password) <= 128:
        return render(request, "auth.html", 400, error="Correo no válido o contraseña de menos de 10 caracteres.", **kw)
    try:
        with db() as c:
            uid = c.execute("INSERT INTO users(email, pw_hash) VALUES(?, ?)",
                            (email, hash_pw(password))).lastrowid
            c.executemany("INSERT INTO fish(user_id, species, name) VALUES(?, ?, ?)",
                          [(uid, s, n) for s, n in DEFAULT_FISH])
    except sqlite3.IntegrityError:  # mensaje genérico: no revela si el correo ya existe
        return render(request, "auth.html", 400, error="No se pudo completar el registro.", **kw)
    start_session(request, uid)
    return RedirectResponse("/panel", 303)


@app.get("/login")
def login_form(request: Request):
    return render(request, "auth.html", modo="login", titulo="Iniciar sesión", action="/login",
                  alt_url="/registro", alt_text="¿No tienes cuenta? Regístrate")


@app.post("/login")
def login(request: Request, email: str = Form(""), password: str = Form(""), csrf: str = Form("")):
    verify_csrf(request, csrf)
    email = email.strip().lower()
    key = f"{request.client.host if request.client else '?'}|{email}"
    kw = dict(modo="login", titulo="Iniciar sesión", action="/login",
              alt_url="/registro", alt_text="¿No tienes cuenta? Regístrate")
    if blocked(key):
        return render(request, "auth.html", 429, error="Demasiados intentos. Espera unos minutos.", **kw)
    with db() as c:
        row = c.execute("SELECT id, pw_hash FROM users WHERE email = ?", (email,)).fetchone()
    ok = check_pw(password[:128], row["pw_hash"] if row else DUMMY_HASH)
    if row and ok:
        FAILS.pop(key, None)
        start_session(request, row["id"])
        return RedirectResponse("/panel", 303)
    FAILS.setdefault(key, []).append(time.time())
    return render(request, "auth.html", 401, error="Correo o contraseña incorrectos.", **kw)


@app.post("/logout")
def logout(request: Request, csrf: str = Form("")):
    verify_csrf(request, csrf)
    request.session.clear()
    return RedirectResponse("/login", 303)


@app.get("/panel")
def panel(request: Request):
    user = current_user(request)
    if not user:
        return RedirectResponse("/login", 303)
    with db() as c:  # todas las consultas filtran por user_id: aislamiento entre usuarios
        domains = c.execute("SELECT id, name FROM domains WHERE user_id = ? ORDER BY id DESC",
                            (user["id"],)).fetchall()
        alerts = c.execute(
            "SELECT a.severity, a.message, d.name AS domain FROM alerts a "
            "JOIN domains d ON d.id = a.domain_id WHERE a.user_id = ? ORDER BY a.id DESC LIMIT 12",
            (user["id"],)).fetchall()
    return render(request, "panel.html", user=user, domains=domains, alerts=alerts,
                  flash=request.session.pop("flash", None))


@app.post("/dominios")
def alta_dominio(request: Request, nombre: str = Form(""), csrf: str = Form("")):
    user = current_user(request)
    if not user:
        return RedirectResponse("/login", 303)
    verify_csrf(request, csrf)
    name = nombre.strip().lower()
    if not (DOMAIN_RE.match(name) and name.endswith(ALLOWED_SUFFIXES)):
        flash(request, "Dominio no válido. Usa uno ficticio: .test, .example, .invalid, .lab "
                       "o un subdominio de example.com, example.org o example.net.")
        return RedirectResponse("/panel", 303)
    try:
        with db() as c:
            if c.execute("SELECT COUNT(*) FROM domains WHERE user_id = ?", (user["id"],)).fetchone()[0] >= 10:
                flash(request, "Máximo 10 dominios por usuario.")
                return RedirectResponse("/panel", 303)
            did = c.execute("INSERT INTO domains(user_id, name) VALUES(?, ?)", (user["id"], name)).lastrowid
            seed = hashlib.sha256(name.encode()).digest()
            for i in sorted({b % len(ALERT_POOL) for b in seed[:3]}):
                sev, msg = ALERT_POOL[i]
                c.execute("INSERT INTO alerts(user_id, domain_id, severity, message) VALUES(?, ?, ?, ?)",
                          (user["id"], did, sev, msg + " (simulado)"))
        flash(request, f"Dominio {name} dado de alta. Alertas generadas de forma simulada.")
    except sqlite3.IntegrityError:
        flash(request, "Ese dominio ya está dado de alta.")
    return RedirectResponse("/panel", 303)


@app.post("/dominios/{domain_id}/borrar")
def baja_dominio(request: Request, domain_id: int, csrf: str = Form("")):
    user = current_user(request)
    if not user:
        return RedirectResponse("/login", 303)
    verify_csrf(request, csrf)
    with db() as c:  # "AND user_id": un usuario nunca borra dominios de otro
        c.execute("DELETE FROM domains WHERE id = ? AND user_id = ?", (domain_id, user["id"]))
    return RedirectResponse("/panel", 303)


# ---- API de peces (la usa aquarium.js) ----
class FishIn(BaseModel):
    species: int = Field(ge=0, lt=SPECIES_COUNT)
    name: str = Field(pattern=r"^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]{1,20}$")


def api_user(request: Request):
    user = current_user(request)
    if not user:
        raise HTTPException(401, "No autenticado")
    return user


@app.get("/api/peces")
def peces(request: Request):
    user = api_user(request)
    with db() as c:
        rows = c.execute("SELECT id, species, name FROM fish WHERE user_id = ? ORDER BY id", (user["id"],))
        return [dict(r) for r in rows]


@app.post("/api/peces", status_code=201)
def añadir_pez(request: Request, fish: FishIn):
    user = api_user(request)
    verify_csrf(request, request.headers.get("x-csrf-token"))
    with db() as c:
        if c.execute("SELECT COUNT(*) FROM fish WHERE user_id = ?", (user["id"],)).fetchone()[0] >= MAX_FISH:
            raise HTTPException(400, f"Máximo {MAX_FISH} peces")
        fid = c.execute("INSERT INTO fish(user_id, species, name) VALUES(?, ?, ?)",
                        (user["id"], fish.species, fish.name)).lastrowid
    return {"id": fid, "species": fish.species, "name": fish.name}


@app.delete("/api/peces/{fish_id}", status_code=204)
def quitar_pez(request: Request, fish_id: int):
    user = api_user(request)
    verify_csrf(request, request.headers.get("x-csrf-token"))
    with db() as c:
        if c.execute("DELETE FROM fish WHERE id = ? AND user_id = ?", (fish_id, user["id"])).rowcount == 0:
            raise HTTPException(404, "Pez no encontrado")
