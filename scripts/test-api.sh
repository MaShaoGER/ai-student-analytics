#!/bin/bash
# API integration test runner
# Starts dev server, runs integration tests, then stops server

set -e

PORT=3000
TEST_FILE="lib/api/api-integration.test.ts"

echo "🚀 Starting dev server on port $PORT..."
pnpm dev &
SERVER_PID=$!

# Wait for server to be ready
echo "⏳ Waiting for server to be ready..."
for i in {1..30}; do
  if curl -s http://localhost:$PORT/api/ai/status > /dev/null 2>&1; then
    echo "✅ Server ready"
    break
  fi
  if [ $i -eq 30 ]; then
    echo "❌ Server failed to start within 30 seconds"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
  fi
  sleep 1
done

# Run integration tests
echo "🧪 Running API integration tests..."
if API_INTEGRATION=1 API_BASE_URL="http://localhost:$PORT" pnpm vitest run $TEST_FILE; then
  echo "✅ All integration tests passed"
  EXIT_CODE=0
else
  echo "❌ Some integration tests failed"
  EXIT_CODE=1
fi

# Stop server
echo "🛑 Stopping dev server..."
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

exit $EXIT_CODE
