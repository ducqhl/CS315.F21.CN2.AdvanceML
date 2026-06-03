FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json .
RUN npm ci --legacy-peer-deps
COPY . .
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf.template
ENV API_UPSTREAM=api:8000
EXPOSE 80
CMD ["/bin/sh", "-c", "envsubst '${API_UPSTREAM}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
