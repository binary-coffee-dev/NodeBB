#!/bin/bash

FILE_NAME="${1:-.env}"

add_env_var() {
  NAME=$1;
  local IS_NEW="${2:-false}";
  VAR="$NAME=${!NAME}"
  if [ "$IS_NEW" = "false" ];
  then
    echo "$VAR" >> "$FILE_NAME"
  else
    echo "$VAR" > "$FILE_NAME"
  fi
}

echo "Creating environment file"

# application environments
add_env_var "DB_PASSWORD" "true"
add_env_var "DB_USER"
add_env_var "URL"
add_env_var "DB_HOST"
add_env_var "DB_PORT"
add_env_var "DB_NAME"
add_env_var "SECRET"
add_env_var "ADMIN_NAME"
add_env_var "ADMIN_EMAIL"
add_env_var "ADMIN_PASSWORD"

# docker configuration
add_env_var "PORT"
add_env_var "DATA_PATH"

# binary integration
add_env_var "BINARY_GRAPHQL_API"
add_env_var "BINARY_LOGIN_PAGE"
