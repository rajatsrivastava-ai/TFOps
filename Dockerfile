# TFOps has no dependencies, so the image is just Node plus the source.
FROM node:22-alpine

WORKDIR /app
COPY . .

# The board lives on a mounted volume, not in the image — otherwise every
# deploy would wipe what the team typed.
ENV DATA_DIR=/data
ENV PORT=8848
ENV TRUST_PROXY=1
VOLUME ["/data"]

EXPOSE 8848

# Seed on first boot only; lib/seed.js leaves an existing store alone.
CMD ["sh", "-c", "node lib/seed.js && node server.js"]
