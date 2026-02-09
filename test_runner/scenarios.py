import grpc
import time
from .grpc_client import GRPCClient

def test_basic_recording():
    """
    Runs a basic end-to-end test scenario:
    1. Connect to the gRPC server.
    2. Start a recording.
    3. Extract the recording_id.
    4. Wait for a few seconds.
    5. Stop the recording.
    6. Return the results.
    """
    log = []
    status = "FAIL"
    client = None
    recording_id = None
    try:
        log.append("Initializing gRPC client...")
        client = GRPCClient()
        
        hq_url = "rtsp://192.168.2.96:8554/test"
        sq_url = "rtsp://192.168.2.96:8554/test"

        log.append(f"Starting recording for urls: {hq_url}, {sq_url}...")
        start_response = client.start_recording(hq_url, sq_url)
        
        if start_response.HasField("error"):
            log.append(f"Failed to start recording: {start_response.error}")
            raise Exception(f"gRPC error on start: {start_response.error.message}")

        recording_id = start_response.created.status.recording_id
        log.append(f"Recording started successfully. Recording ID: {recording_id}")
        log.append(f"Full start response: {start_response}")

        log.append("Waiting for 10 seconds...")
        time.sleep(10)

        log.append(f"Stopping recording for recording_id: {recording_id}...")
        stop_response = client.stop_recording(recording_id)
        
        if stop_response.HasField("error"):
            log.append(f"Failed to stop recording: {stop_response.error}")
            raise Exception(f"gRPC error on stop: {stop_response.error.message}")

        log.append(f"Stop recording response: {stop_response}")

        log.append("Test scenario completed successfully.")
        status = "PASS"

    except grpc.RpcError as e:
        log.append(f"A gRPC error occurred: {e.code()} - {e.details()}")
        status = "FAIL"
    except Exception as e:
        log.append(f"An unexpected error occurred: {e}")
        status = "FAIL"
    finally:
        if client:
            client.close()
            log.append("gRPC client closed.")

    return {"status": status, "log": "\n".join(log)}

if __name__ == '__main__':
    # To run this scenario directly for debugging
    result = test_basic_recording()
    print("---" + " Test Result ---")
    print(f"Status: {result['status']}")
    print("---" + " Log ---")
    print(result['log'])
