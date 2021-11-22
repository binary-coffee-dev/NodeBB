FROM node:14.18.0-alpine3.11

RUN apk update && apk upgrade && \
    apk add --no-cache bash git openssh

RUN mkdir -p /usr/src/app && \
    chown -R node:node /usr/src/app
WORKDIR /usr/src/app

ARG NODE_ENV
ENV NODE_ENV $NODE_ENV

RUN git -C /usr/src clone https://github.com/binary-coffee-dev/nodebb-theme-binarycoffee.git
RUN cd /usr/src/nodebb-theme-binarycoffee && npm install

COPY --chown=node:node install/package.json /usr/src/app/package.json

USER node

RUN npm install --only=prod && \
    npm cache clean --force

RUN ln -s /usr/src/nodebb-theme-binarycoffee /usr/src/app/node_modules/nodebb-theme-binarycoffee

COPY --chown=node:node . /usr/src/app

ENV NODE_ENV=production \
    daemon=false \
    silent=false

CMD node ./nodebb build ;  node ./nodebb start
