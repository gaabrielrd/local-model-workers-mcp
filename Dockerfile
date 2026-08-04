FROM node:24-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist ./dist
COPY README.md ./
COPY docs/ ./docs/

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/cli/index.js"]
