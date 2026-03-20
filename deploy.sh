#!/bin/bash
set -e

cd /opt/soaralarm

echo "Pulling latest changes..."
git pull

echo "Installing backend dependencies..."
cd backend
.venv/bin/pip install -r requirements.txt --quiet

echo "Building frontend..."
cd ../frontend
npm install --silent
npm run build

echo "Restarting service..."
sudo systemctl restart soaralarm

echo "Deploy complete!"
