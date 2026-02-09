#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.

# This script generates the Python code for protobufs and starts the test tool.

# --- Setup Paths ---
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$SCRIPT_DIR/.."
PYTHON_EXEC="$SCRIPT_DIR/venv/bin/python3"

# --- 0. Verify Environment ---
if [ ! -f "$PYTHON_EXEC" ]; then
    echo "❌ Python executable not found at: $PYTHON_EXEC"
    echo "   Please ensure the virtual environment has been created inside 'vrm_test_tool'."
    # fallback to system python if venv not found (for dev container)
    PYTHON_EXEC="python3"
    echo "   Trying system python: $PYTHON_EXEC"
fi
echo "Using Python: $PYTHON_EXEC"
echo ""

# --- 1. Sync Proto Files ---
# Skipped: Protos are manually copied from atfr-core deps.
# SOURCE_DIR="$PROJECT_ROOT/protos/"
# DEST_DIR="$SCRIPT_DIR/protos/"
# ...

# --- 2. Generate Python Code ---
echo "Generating Python protobuf code..."

# Change to the project root directory to ensure consistent paths.
cd "$PROJECT_ROOT"

# Check if python grpc tools are installed.
if ! "$PYTHON_EXEC" -c "import grpc_tools.protoc" &> /dev/null; then
    echo "⚠️  Python grpc_tools are not installed. Attempting to install..."
    "$PYTHON_EXEC" -m pip install grpcio-tools
fi

PROTO_TOOL_DIR="vrm_test_tool/protos"
# Set include path to protos directory so imports like "video_recorder/..." work
PROTO_INCLUDE_DIR="vrm_test_tool/protos" 
PROTO_OUT_DIR="vrm_test_tool" 

echo "Running protoc compiler..."
"$PYTHON_EXEC" -m grpc_tools.protoc \
    -I=${PROTO_INCLUDE_DIR} \
    --python_out=${PROTO_OUT_DIR} \
    --grpc_python_out=${PROTO_OUT_DIR} \
    ${PROTO_TOOL_DIR}/common/echo.proto \
    ${PROTO_TOOL_DIR}/video_recorder/common/types.proto \
    ${PROTO_TOOL_DIR}/video_recorder/common/errors.proto \
    ${PROTO_TOOL_DIR}/video_recorder/health/jitter.proto \
    ${PROTO_TOOL_DIR}/video_recorder/health/health.proto \
    ${PROTO_TOOL_DIR}/video_recorder/recorder/clip.proto \
    ${PROTO_TOOL_DIR}/video_recorder/recorder/encoding.proto \
    ${PROTO_TOOL_DIR}/video_recorder/recorder/record.proto \
    ${PROTO_TOOL_DIR}/video_recorder/recorder/snapshot.proto

# Create __init__.py files
echo "Creating __init__.py files..."
touch ${PROTO_TOOL_DIR}/common/__init__.py
touch ${PROTO_TOOL_DIR}/video_recorder/__init__.py
touch ${PROTO_TOOL_DIR}/video_recorder/common/__init__.py
touch ${PROTO_TOOL_DIR}/video_recorder/health/__init__.py
touch ${PROTO_TOOL_DIR}/video_recorder/recorder/__init__.py

echo "✅ Python code generated successfully."
echo ""

# --- 3. Start the Test Tool Web Server ---
echo "Starting the VRM Test Tool web server..."
echo "Access it at: http://127.0.0.1:5001"
echo "Press Ctrl+C to stop the server."
echo ""

"$PYTHON_EXEC" vrm_test_tool/app.py