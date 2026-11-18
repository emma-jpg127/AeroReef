# Aero Reef

Acuario virtual educativo con estética Frutiger Aero, usado como aplicación de laboratorio en las prácticas de Puesta en Producción Segura, Hacking Ético y Gestión de Incidentes.

Está hecho con FastAPI, SQLite y Docker. Tiene registro, inicio de sesión, un panel con un arrecife de coral animado, alta de dominios ficticios con alertas simuladas y cierre de sesión. No analiza dominios reales ni hace peticiones de red.

## Requisitos

- Ubuntu 22.04 o 24.04
- Docker Engine con el plugin Compose ([instalación oficial para Ubuntu](https://docs.docker.com/engine/install/ubuntu/))
- Git y un navegador

## Puesta en marcha

```bash
cp .env.example .env
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

Pega la clave generada como valor de `SESSION_SECRET` en `.env`. Ese archivo no se sube a Git ni se entrega.

```bash
docker compose up --build -d
docker compose ps
curl -fsS http://localhost:8000/health
docker compose logs --tail=30 web
```

Abre http://localhost:8000 en el navegador de la propia máquina (el puerto solo escucha en `127.0.0.1`). Para detenerlo:

```bash
docker compose down
```

Los datos se guardan en el volumen `aeroreef-data` y se conservan al reiniciar o detener el contenedor. `docker compose down -v` borra también el volumen.

## Pruebas automáticas

```bash
sudo apt install python3-venv     # si no está instalado
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
python -m pytest
```

## Estructura

| Ruta | Contenido |
| --- | --- |
| `app/main.py` | Servidor FastAPI: rutas, sesiones, base de datos y medidas de seguridad |
| `app/templates/` | Páginas HTML (plantillas Jinja2) |
| `app/static/aquarium.js` | Animación del acuario en un `<canvas>` |
| `app/static/style.css` | Estilos de la interfaz |
| `tests/test_app.py` | Pruebas automáticas |
| `Dockerfile`, `compose.yaml` | Imagen y despliegue del contenedor |
| `.env.example` | Plantilla de configuración, sin secretos |
| `entregas/PLANTILLA.md` | Plantilla para las entregas de la práctica |

## Normas del laboratorio

Trabaja solo en `localhost` y en activos autorizados por el profesor, con datos y cuentas ficticios. No publiques el contenedor en Internet ni subas `.env`, contraseñas, tokens o bases de datos.
