@echo off
title Regard Senat - API
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

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERREUR] Node.js et npm sont requis pour construire le frontend React.
    pause
    exit /b 1
)

pushd frontend
if not exist node_modules (
    echo [INFO] Installation des dependances du frontend...
    call npm ci
    if errorlevel 1 (
        popd
        echo [ERREUR] Echec de l'installation des dependances du frontend.
        pause
        exit /b 1
    )
)

echo [INFO] Construction du frontend React...
call npm run build
if errorlevel 1 (
    popd
    echo [ERREUR] Echec de la construction du frontend React.
    pause
    exit /b 1
)
popd

echo [INFO] React : http://localhost:8000/   Ancienne interface : http://localhost:8000/legacy
echo [INFO] Documentation API : http://localhost:8000/docs
python backend\run.py
pause
