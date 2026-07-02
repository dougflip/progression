FROM mcr.microsoft.com/playwright:v1.60.0-jammy

# container is run with --user "$(id -u):$(id -g)", which won't match the
# root-owned files from COPY below — git refuses to touch a repo it doesn't
# own unless told otherwise. --system avoids relying on $HOME for the
# arbitrary uid the container runs as.
RUN git config --system --add safe.directory /app

WORKDIR /app

# Install app dependencies
COPY package*.json ./
RUN npm ci

# Install e2e dependencies
COPY e2e/package*.json ./e2e/
RUN cd e2e && npm ci

# Copy source and build the app
COPY . .
RUN npm run build

RUN chmod 777 /app/e2e

WORKDIR /app/e2e

CMD ["npm", "test"]
