#!/bin/bash
set -e

echo "Building e2e test image..."
docker build -f e2e/Dockerfile -t progression-e2e .

echo "Running e2e tests..."
docker run --rm \
  -e CI="${CI:-false}" \
  -v "$(pwd)/e2e/tests:/app/e2e/tests" \
  -v "$(pwd)/e2e/playwright-report:/app/e2e/playwright-report" \
  -v "$(pwd)/e2e/test-results:/app/e2e/test-results" \
  progression-e2e npm test -- "$@"

echo "E2E tests completed!"
