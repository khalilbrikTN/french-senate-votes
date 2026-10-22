@echo off
title Regard Senat - Migrations du schema
chcp 65001 > nul
cd /d "%~dp0"

python --version >nul 2>&1
if errorlevel 1 (
    echo [ERREUR] Python est introuvable dans le PATH. Installez-le depuis https://www.python.org/
    pause
    exit /b 1
)

if not exist "backend\.env.local" (
    echo [ERREUR] backend\.env.local est absent. Copiez backend\.env.example et renseignez DATABASE_URL.
    pause
    exit /b 1
)

echo [INFO] Installation des dependances...
python -m pip install --quiet --disable-pip-version-check -r backend\requirements.txt
if errorlevel 1 (
    echo [ERREUR] Echec de l'installation des dependances.
    pause
    exit /b 1
)

rem Sans argument : etat des migrations. Exemples : migrate.bat apply   /   migrate.bat apply --commit
cd /d "%~dp0backend"
if "%~1"=="" (
    python migrate.py status
) else (
    python migrate.py %*
)
if errorlevel 1 (
    echo [ERREUR] La commande a echoue ou a ete refusee. Voir les messages ci-dessus.
    pause
    exit /b 1
)
pause
