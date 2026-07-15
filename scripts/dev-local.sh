#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_DIR="${TOOLS_DIR:-/root/workspace/.tools}"
GO_BIN="${TOOLS_DIR}/go/bin/go"
BUN_BIN="${TOOLS_DIR}/bun/bin/bun"
BACKEND_PORT="${BACKEND_PORT:-3000}"
FRONTEND_PORT="${FRONTEND_PORT:-3002}"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env}"
RUN_DIR="${ROOT_DIR}/dev-logs"
BUILD_DIR="${ROOT_DIR}/build"
BACKEND_PID_FILE="${RUN_DIR}/backend.pid"
FRONTEND_PID_FILE="${RUN_DIR}/frontend.pid"

is_running() {
  local pid_file="$1"
  [[ -f "${pid_file}" ]] && kill -0 "$(<"${pid_file}")" 2>/dev/null
}

load_environment() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    echo "Missing environment file: ${ENV_FILE}" >&2
    exit 1
  fi

  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a

  export SQL_DSN="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}"
  export REDIS_CONN_STRING="${REDIS_CONN_STRING:-}"
  export REDIS_CONN_STRING="${REDIS_CONN_STRING/@redis/@127.0.0.1}"
  export DEBUG="${DEBUG:-true}"
  export GIN_MODE="${GIN_MODE:-debug}"
}

start_services() {
  if is_running "${BACKEND_PID_FILE}" || is_running "${FRONTEND_PID_FILE}"; then
    echo "Development services are already running." >&2
    exit 1
  fi
  if [[ ! -x "${GO_BIN}" || ! -x "${BUN_BIN}" ]]; then
    echo "Go or Bun is missing from ${TOOLS_DIR}." >&2
    exit 1
  fi

  load_environment
  mkdir -p "${RUN_DIR}/backend" "${BUILD_DIR}"

  (
    cd "${ROOT_DIR}"
    PATH="${TOOLS_DIR}/go/bin:${TOOLS_DIR}/bun/bin:${PATH}" \
      GOMODCACHE="${ROOT_DIR}/.gomodcache" \
      GOCACHE="${ROOT_DIR}/.gocache" \
      "${GO_BIN}" build \
        -ldflags "-X github.com/QuantumNous/new-api/common.Version=$(<"${ROOT_DIR}/VERSION")" \
        -o "${BUILD_DIR}/new-api-dev" .
  )

  nohup setsid "${BUILD_DIR}/new-api-dev" \
    --port "${BACKEND_PORT}" \
    --log-dir "${RUN_DIR}/backend" \
    >"${RUN_DIR}/backend-console.log" 2>&1 </dev/null &
  echo "$!" >"${BACKEND_PID_FILE}"

  (
    cd "${ROOT_DIR}/web/default"
    nohup setsid env \
      VITE_REACT_APP_SERVER_URL="http://127.0.0.1:${BACKEND_PORT}" \
      "${BUN_BIN}" run dev --port "${FRONTEND_PORT}" \
      >"${RUN_DIR}/frontend-console.log" 2>&1 </dev/null &
    echo "$!" >"${FRONTEND_PID_FILE}"
  )

  echo "Backend:  http://0.0.0.0:${BACKEND_PORT}"
  echo "Frontend: http://0.0.0.0:${FRONTEND_PORT}"
}

stop_process() {
  local name="$1"
  local pid_file="$2"
  if ! is_running "${pid_file}"; then
    rm -f "${pid_file}"
    echo "${name}: stopped"
    return
  fi

  local pid
  pid="$(<"${pid_file}")"
  kill -- "-${pid}" 2>/dev/null || kill "${pid}"
  for _ in {1..20}; do
    if ! kill -0 "${pid}" 2>/dev/null; then
      break
    fi
    sleep 0.25
  done
  rm -f "${pid_file}"
  echo "${name}: stopped"
}

stop_services() {
  stop_process "Frontend" "${FRONTEND_PID_FILE}"
  stop_process "Backend" "${BACKEND_PID_FILE}"
}

show_status() {
  if is_running "${BACKEND_PID_FILE}"; then
    echo "Backend: running (PID $(<"${BACKEND_PID_FILE}"), port ${BACKEND_PORT})"
  else
    echo "Backend: stopped"
  fi
  if is_running "${FRONTEND_PID_FILE}"; then
    echo "Frontend: running (PID $(<"${FRONTEND_PID_FILE}"), port ${FRONTEND_PORT})"
  else
    echo "Frontend: stopped"
  fi
}

case "${1:-start}" in
  start)
    start_services
    ;;
  stop)
    stop_services
    ;;
  restart)
    stop_services
    start_services
    ;;
  status)
    show_status
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status}" >&2
    exit 2
    ;;
esac
