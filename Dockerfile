FROM node:lts

RUN apt update && \
    apt install -y bash nano

RUN mkdir -p /usr/src/app \
    && mkdir -p /data
WORKDIR /usr/src/app

ENV NODE_ENV=production \
    daemon=false \
    silent=false

COPY install/package.json /usr/src/app/package.json

RUN npm install --only=prod \
    && npm cache clean --force

COPY . /usr/src/app

RUN rm -f config.json \
    && chmod +x init.sh

ENTRYPOINT [ "./init.sh" ]
