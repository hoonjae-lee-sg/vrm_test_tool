import requests
import time
import subprocess
import sys

def test_endpoints():
    base_url = "http://localhost:5001"
    
    # Wait for server to start
    print("Waiting for server to start...")
    for _ in range(10):
        try:
            requests.get(base_url)
            break
        except requests.exceptions.ConnectionError:
            time.sleep(1)
    else:
        print("Server failed to start")
        return

    print("Server started. Testing endpoints...")

    # Test /api/clip
    print("\nTesting /api/clip...")
    try:
        response = requests.post(f"{base_url}/api/clip", json={
            "recording_id": "test_recording_id",
            "seconds": 1678888888,
            "nanos": 0
        })
        print(f"Status Code: {response.status_code}")
        print(f"Response: {response.json()}")
    except Exception as e:
        print(f"Error testing /api/clip: {e}")

    # Test /api/snapshot
    print("\nTesting /api/snapshot...")
    try:
        response = requests.post(f"{base_url}/api/snapshot", json={
            "recording_id": "test_recording_id",
            "seconds": 1678888888,
            "nanos": 0
        })
        print(f"Status Code: {response.status_code}")
        print(f"Response: {response.json()}")
    except Exception as e:
        print(f"Error testing /api/snapshot: {e}")

    # Test /api/health
    print("\nTesting /api/health...")
    try:
        response = requests.get(f"{base_url}/api/health", params={
            "recording_id": "test_recording_id"
        })
        print(f"Status Code: {response.status_code}")
        print(f"Response: {response.json()}")
    except Exception as e:
        print(f"Error testing /api/health: {e}")

if __name__ == "__main__":
    # Start the app in the background
    import os
    script_dir = os.path.dirname(os.path.abspath(__file__))
    process = subprocess.Popen([sys.executable, "app.py"], cwd=script_dir)
    
    try:
        test_endpoints()
    finally:
        process.terminate()
        process.wait()
