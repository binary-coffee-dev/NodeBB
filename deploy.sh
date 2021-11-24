#!/bin/bash

echo "Starting project in docker"

PROJECT_NAME="${1:-dev_nodebb}"

echo "Docker container name: $PROJECT_NAME";
docker-compose --project-name="$PROJECT_NAME" build
docker-compose --project-name="$PROJECT_NAME" down
docker-compose --project-name="$PROJECT_NAME" up -d
