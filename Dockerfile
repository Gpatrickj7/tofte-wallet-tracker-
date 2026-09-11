# Two stages: build with dev dependencies, run with only what the server needs.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/.next ./.next
COPY next.config.ts tsconfig.json ./
EXPOSE 3000
# Runs as the unprivileged user the base image provides.
USER node
CMD ["npm", "start"]
