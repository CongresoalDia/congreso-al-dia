"""Actualiza los datos del Senado y los sube al repositorio.

La API del Senado responde 403 a los servidores de GitHub Actions, así que esta parte se corre desde un PC
(por ejemplo, con el Programador de tareas de Windows): trae lo último, corre senado.py y sube web/senado/
si cambió algo. La Cámara y el presupuesto se actualizan solos en GitHub Actions.

Uso: python pipeline/actualizar_senado.py
"""
import subprocess
import sys
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


def git(*args):
    return subprocess.run(["git", *args], cwd=RAIZ, check=True, capture_output=True, text=True).stdout


def main():
    git("pull", "--rebase", "--autostash", "origin", "main")
    subprocess.run([sys.executable, str(RAIZ / "pipeline" / "senado.py")], cwd=RAIZ, check=True)
    git("add", "web/senado")
    if not git("diff", "--cached", "--name-only").strip():
        print("Senado: sin cambios.")
        return
    git("commit", "-m", f"Datos del Senado al {datetime.now():%d-%m-%Y}")
    git("pull", "--rebase", "origin", "main")  # por si la actualización de GitHub subió algo entremedio
    git("push", "origin", "main")
    print("Senado: cambios subidos.")


if __name__ == "__main__":
    main()
