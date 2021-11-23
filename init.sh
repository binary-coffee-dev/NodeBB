#!/bin/bash
set -e

if [ -f .env ]; then
  export $(cat .env | xargs)
fi

CONFIG=$(
  cat <<-END
{
    "url": "$URL",
    "database": "mongo",
    "port": "$PORT",
    "mongo:host": "$DB_HOST",
    "mongo:port": "$DB_PORT",
    "mongo:username": "$DB_USER",
    "mongo:password": "$DB_PASSWORD",
    "mongo:database": "$DB_NAME",
    "admin:username": "$ADMIN_NAME",
    "admin:password": "$ADMIN_PASSWORD",
    "admin:password:confirm": "$ADMIN_PASSWORD",
    "admin:email": "$ADMIN_EMAIL"
}
END
)
if ! [ -e /data/config.json ]; then

  node app --setup=\"$(printf '%s' $(echo $CONFIG))\"

  mv /usr/src/app/config.json /data/config.json
  ln -s /data/config.json /usr/src/app/config.json

else

  if [ ! -e /usr/src/app/config.json ]; then
    ln -s /data/config.json /usr/src/app/config.json
  fi

fi

if [ ! -e /data/uploads ]; then
  mv /usr/src/app/public/uploads /data/uploads &&
    ln -s /data/uploads /usr/src/app/public/uploads
else
  rm -rf /usr/src/app/public/uploads &&
    ln -s /data/uploads /usr/src/app/public/uploads
fi

if [ -f config.json ]; then
  node ./add-configs.js

  /usr/src/app/nodebb build --series
  /usr/src/app/nodebb upgrade -mips
fi

/usr/src/app/nodebb start
