#!/bin/sh
# =============================================================================
# OpenAssist Docker Entrypoint
# Handles proper startup/shutdown and initialization
# =============================================================================

set -e

echo "Starting OpenAssist..."

# Ensure data directory exists
if [ ! -d "/app/data" ]; then
    echo "Creating data directory..."
    mkdir -p /app/data
fi

# Ensure proper permissions on data directory
if [ "$(id -u)" = "0" ]; then
    chown -R nodejs:nodejs /app/data
fi

# Wait for any dependencies to be ready (e.g., external services)
# Add your custom wait logic here if needed

# Run database migrations if needed
# Example: node dist/migrate.js

echo "OpenAssist started successfully"

# Execute the main command
exec "$@"
