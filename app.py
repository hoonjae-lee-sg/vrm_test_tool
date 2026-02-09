import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import grpc
from flask import Flask, render_template, jsonify, request
from google.protobuf.json_format import MessageToDict
from google.protobuf import timestamp_pb2
from test_runner.grpc_client import GRPCClient

app = Flask(__name__)
grpc_client = GRPCClient()

def proto_to_dict(message):
    """Converts a protobuf message to a dictionary."""
    return MessageToDict(
        message,
        preserving_proto_field_name=True
    )

@app.route('/')
def index():
    return render_template('dashboard.html')

@app.route('/live')
def live_view():
    return render_template('live.html')

@app.route('/tester')
def tester():
    return render_template('index.html')

@app.route('/playlist')
def playlist():
    return render_template('playlist.html')







@app.route('/api/start', methods=['POST'])
def api_start_recording():
    """API endpoint to start a recording."""
    data = request.get_json()
    
    # Required fields
    hq_url = data.get('hq_url')
    sq_url = data.get('sq_url')
    if not hq_url or not sq_url:
        return jsonify({"error": "hq_url and sq_url are required"}), 400

    # Optional fields
    client = None
    try:
        client = GRPCClient()
        response = client.start_recording(
            hq_url=hq_url, 
            sq_url=sq_url,
            hq_storage_limit_mbs=data.get('hq_storage_limit_mbs'),
            sq_storage_limit_mbs=data.get('sq_storage_limit_mbs'),
            retention_days=data.get('retention_days'),
            recording_mode=data.get('recording_mode'),
            auth_token=data.get('auth_token'),
            notes=data.get('notes'),
            encoding_codec=data.get('encoding_codec'),
            serial_number=data.get('serial_number')
        )
        return jsonify(proto_to_dict(response))
    except grpc.RpcError as e:
        return jsonify({"error": {"code": e.code().name, "details": e.details()}}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        if client:
            client.close()

@app.route('/api/stop', methods=['POST'])
def api_stop_recording():
    """API endpoint to stop a recording."""
    data = request.get_json()
    recording_id = data.get('recording_id')
    auth_token = data.get('auth_token')

    print(f"Received stop request for recording_id: '{recording_id}'")

    if not recording_id:
        return jsonify({"error": "recording_id is required"}), 400

    client = None
    try:
        client = GRPCClient()
        response = client.stop_recording(recording_id=recording_id, auth_token=auth_token)
        return jsonify(proto_to_dict(response))
    except grpc.RpcError as e:
        print(f"gRPC Error: {e.code().name} - {e.details()}")
        status_code = 500
        if e.code() == grpc.StatusCode.NOT_FOUND:
            status_code = 404
        elif e.code() == grpc.StatusCode.INVALID_ARGUMENT:
            status_code = 400
        elif e.code() == grpc.StatusCode.UNAUTHENTICATED:
            status_code = 401
        
        return jsonify({"error": {"code": e.code().name, "details": e.details()}}), status_code
    except Exception as e:
        print(f"Unexpected Error: {str(e)}")
        return jsonify({"error": str(e)}), 500
    finally:
        if client:
            client.close()

@app.route('/api/status', methods=['GET'])
def api_get_status():
    """API endpoint to get recording status."""
    recording_id = request.args.get('recording_id')
    auth_token = request.args.get('auth_token')

    if not recording_id:
        return jsonify({"error": "recording_id is required"}), 400

    client = None
    try:
        client = GRPCClient()
        response = client.get_recording_status(recording_id=recording_id, auth_token=auth_token)
        return jsonify(proto_to_dict(response))
    except grpc.RpcError as e:
        return jsonify({"error": {"code": e.code().name, "details": e.details()}}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        if client:
            client.close()

@app.route('/api/event/start', methods=['POST'])
def api_start_event_clip():
    """API endpoint to start an event clip."""
    data = request.get_json()
    recording_id = data.get('recording_id')
    auth_token = data.get('auth_token')

    if not recording_id:
        return jsonify({"error": "recording_id is required"}), 400

    client = None
    try:
        client = GRPCClient()
        response = client.start_event_clip(recording_id=recording_id, auth_token=auth_token)
        return jsonify(proto_to_dict(response))
    except grpc.RpcError as e:
        return jsonify({"error": {"code": e.code().name, "details": e.details()}}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        if client:
            client.close()

@app.route('/api/event/stop', methods=['POST'])
def api_stop_event_clip():
    """API endpoint to stop an event clip."""
    data = request.get_json()
    recording_id = data.get('recording_id')
    auth_token = data.get('auth_token')

    if not recording_id:
        return jsonify({"error": "recording_id is required"}), 400

    client = None
    try:
        client = GRPCClient()
        response = client.stop_event_clip(recording_id=recording_id, auth_token=auth_token)
        return jsonify(proto_to_dict(response))
    except grpc.RpcError as e:
        return jsonify({"error": {"code": e.code().name, "details": e.details()}}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        if client:
            client.close()


@app.route('/api/clip', methods=['POST'])
def api_create_clip():
    """API endpoint to create a simple clip."""
    data = request.get_json()
    recording_id = data.get('recording_id')
    seconds = data.get('seconds')
    nanos = data.get('nanos', 0)

    if not recording_id or seconds is None:
        return jsonify({"error": "recording_id and seconds are required"}), 400

    client = None
    try:
        client = GRPCClient()
        timestamp = timestamp_pb2.Timestamp(seconds=int(seconds), nanos=int(nanos))
        response = client.create_simple_clip(recording_id=recording_id, timestamp=timestamp)
        return jsonify(proto_to_dict(response))
    except grpc.RpcError as e:
        return jsonify({"error": {"code": e.code().name, "details": e.details()}}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        if client:
            client.close()

@app.route('/api/snapshot', methods=['POST'])
def api_take_snapshot():
    """API endpoint to take a snapshot."""
    data = request.get_json()
    recording_id = data.get('recording_id')
    seconds = data.get('seconds')
    nanos = data.get('nanos', 0)
    timestamp = None
    strategy = data.get('strategy') # Allow overriding strategy
    max_offset_ms = data.get('max_offset_ms')

    if seconds is not None:
        timestamp = timestamp_pb2.Timestamp()
        timestamp.seconds = int(seconds)
        if nanos is not None:
            timestamp.nanos = int(nanos)
        
        # Default to PRECISE (4) if not specified when timestamp is present
        if strategy is None:
            strategy = 4 
        
        print(f"DEBUG: Snapshot requested for {recording_id} at {timestamp.seconds}.{timestamp.nanos} with strategy {strategy}, offset {max_offset_ms}", flush=True)

    # Construct args for grpc call
    kwargs = {'recording_id': recording_id, 'timestamp': timestamp}
    if strategy is not None:
        kwargs['strategy'] = int(strategy)
    if max_offset_ms is not None:
        kwargs['max_offset_ms'] = int(max_offset_ms)
    
    try:
        response = grpc_client.take_snapshot(**kwargs)
        return jsonify(MessageToDict(response))
    except grpc.RpcError as e:
        print(f"DEBUG: gRPC Error: {e.code()} - {e.details()}", flush=True)
        return jsonify({"error": {"code": e.code().name, "details": e.details()}}), 500

@app.route('/api/health', methods=['GET'])
def api_get_health():
    """API endpoint to check recording health."""
    recording_id = request.args.get('recording_id')
    auth_token = request.args.get('auth_token')

    if not recording_id:
        return jsonify({"error": "recording_id is required"}), 400

    client = None
    try:
        client = GRPCClient()
        response = client.get_recording_healthy(recording_id=recording_id, auth_token=auth_token)
        return jsonify(proto_to_dict(response))
    except grpc.RpcError as e:
        return jsonify({"error": {"code": e.code().name, "details": e.details()}}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        if client:
            client.close()

@app.route('/api/recordings', methods=['GET'])
def api_list_recordings():
    """API endpoint to list recordings using gRPC and filesystem fallback."""
    import os
    from datetime import datetime
    
    # Get data path - relative to VRM project root
    vrm_root = os.path.dirname(os.path.dirname(__file__))
    data_path = os.path.join(vrm_root, 'data')
    
    recordings_map = {}
    
    # 1. Fetch from gRPC (Primary Source)
    client = None
    try:
        client = GRPCClient()
        grpc_recordings = client.list_recordings()
        for rec in grpc_recordings:
            rec_dict = proto_to_dict(rec)
            # Ensure state is readable
            # state enum: 0=PENDING, 1=RUNNING, 2=STOPPING, 3=STOPPED, 4=ERROR
            # The dict might have string or int depending on proto_to_dict settings.
            # MessageToDict uses strings for enums by default.
            recordings_map[rec_dict['recording_id']] = rec_dict
    except Exception as e:
        print(f"Warning: Failed to fetch recordings from gRPC: {e}")
    finally:
        if client:
            client.close()
            
    # 2. Scan filesystem (Secondary Source / Augmentation)
    if os.path.exists(data_path):
        try:
            for item in os.listdir(data_path):
                item_path = os.path.join(data_path, item)
                if os.path.isdir(item_path):
                    # If already in map, skip or update?
                    # gRPC is more accurate for state, so keep gRPC data.
                    if item in recordings_map:
                        continue
                        
                    # Found on disk but not in memory (e.g. old recording)
                    stat_info = os.stat(item_path)
                    created_at = datetime.fromtimestamp(stat_info.st_ctime).isoformat()
                    
                    recordings_map[item] = {
                        "recording_id": item,
                        "state": "STOPPED", # Assume stopped if not in memory
                        "created_at": created_at,
                        "rtsp_url_hq": "N/A (Disk Only)",
                        "rtsp_url_sq": "N/A (Disk Only)",
                        "storage_used_mbs": 0,
                        "notes": "Found on disk",
                        "retention_days": 0,
                        "recording_mode": "N/A"
                    }
        except Exception as e:
            print(f"Error scanning filesystem: {e}")
            
    # Convert map to list and sort
    recordings = list(recordings_map.values())
    # Sort by created_at if available, else put at bottom
    recordings.sort(key=lambda x: x.get('created_at', ''), reverse=True)
    
    return jsonify(recordings)

@app.route('/api/recordings/<recording_id>/segments', methods=['GET'])
def api_recording_segments(recording_id):
    """API endpoint to list HLS segments for a recording."""
    import os
    
    # Get data path - relative to VRM project root
    vrm_root = os.path.dirname(os.path.dirname(__file__))
    data_path = os.path.join(vrm_root, 'data')
    
    # Assume HQ recording for now, as per user request context (Snapshot usually uses HQ)
    # Path: data/<recording_id>/hq/YYMMDD/HH/*.ts
    # Note: recording_id might be a logical ID or a full ID. 
    # If the user passes a full ID like "rec_123", the directory is "rec_123".
    # If the user passes "rec_123-hq", we should strip "-hq" or check existence.
    
    recording_dir = os.path.join(data_path, recording_id)
    # Check for 'playback/hq' structure first
    hq_dir = os.path.join(recording_dir, 'playback', 'hq')
    
    if not os.path.exists(hq_dir):
        # Fallback to just 'hq' if 'playback' doesn't exist (legacy support?)
        hq_dir = os.path.join(recording_dir, 'hq')
        if not os.path.exists(hq_dir):
             return jsonify({"error": "Recording directory not found", "segments": [], "playlists": []}), 404
        
    segments_map = {} # timestamp -> duration
    playlists = []
    
    try:
        # 1. Scan for .ts files first to populate base list
        for root, dirs, files in os.walk(hq_dir):
            for file in files:
                if file.endswith('.ts'):
                    try:
                        timestamp_str = os.path.splitext(file)[0]
                        timestamp = int(timestamp_str)
                        segments_map[timestamp] = 10.0 # Default duration
                    except ValueError:
                        continue

                elif file.endswith('.m3u8'):
                    # Store relative path
                    rel_path = os.path.relpath(os.path.join(root, file), recording_dir)
                    playlists.append(rel_path)
                    
                    # Parse m3u8 for durations
                    try:
                        with open(os.path.join(root, file), 'r') as f:
                            content = f.read()
                            # Simple parsing: look for #EXTINF:duration,\nfilename
                            import re
                            # Regex to capture duration and filename
                            # #EXTINF:10.000000,
                            # 1763526461.ts
                            matches = re.findall(r'#EXTINF:(\d+\.?\d*),\s*(\d+)\.ts', content)
                            for duration_str, ts_str in matches:
                                try:
                                    ts = int(ts_str)
                                    dur = float(duration_str)
                                    segments_map[ts] = dur
                                except ValueError:
                                    pass
                    except Exception as e:
                        print(f"Error parsing playlist {file}: {e}")

        # Convert map to sorted list of dicts
        segment_list = []
        for ts in sorted(segments_map.keys()):
            segment_list.append({
                "start": ts,
                "duration": segments_map[ts]
            })
            
        playlists.sort()
        return jsonify({"segments": segment_list, "playlists": playlists})
    except Exception as e:
        return jsonify({"error": str(e), "segments": [], "playlists": []}), 500

# Action endpoints for Recording List
@app.route('/api/recordings/<recording_id>/status', methods=['GET'])
def api_recording_action_status(recording_id):
    # Reuse existing logic
    client = None
    try:
        client = GRPCClient()
        response = client.get_recording_status(recording_id=recording_id)
        return jsonify(proto_to_dict(response))
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        if client: client.close()

@app.route('/api/recordings/<recording_id>/stop', methods=['POST'])
def api_recording_action_stop(recording_id):
    client = None
    try:
        client = GRPCClient()
        response = client.stop_recording(recording_id=recording_id)
        return jsonify(proto_to_dict(response))
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        if client: client.close()

@app.route('/api/recordings/<recording_id>/start-event-clip', methods=['POST'])
def api_recording_action_start_event(recording_id):
    client = None
    try:
        client = GRPCClient()
        response = client.start_event_clip(recording_id=recording_id)
        return jsonify(proto_to_dict(response))
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        if client: client.close()

@app.route('/api/recordings/<recording_id>/stop-event-clip', methods=['POST'])
def api_recording_action_stop_event(recording_id):
    client = None
    try:
        client = GRPCClient()
        response = client.stop_event_clip(recording_id=recording_id)
        return jsonify(proto_to_dict(response))
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        if client: client.close()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)
