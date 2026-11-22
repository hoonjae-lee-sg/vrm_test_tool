#include <iostream>
#include <thread>
#include <gst/gst.h>
#include <gst/rtsp-server/rtsp-server.h>
#include <opencv2/opencv.hpp>
#include <opencv2/videoio.hpp>
#include <chrono>
#include "misb/misb.hpp"

// Global variables for metadata appsrc
GstElement *meta_appsrc = nullptr;

int main(int argc, char *argv[])
{
    if (argc < 3) {
        std::cerr << "Usage: " << argv[0] << " <port> <input_video_path>" << std::endl;
        return -1;
    }

    int port = std::stoi(argv[1]);
    std::string video_path = argv[2];
    int meta_port = port + 1;

    gst_init(&argc, &argv);

    // ---------------------------------------------------------
    // 1. Setup RTSP Server
    // ---------------------------------------------------------
    GMainLoop *serverloop = g_main_loop_new(NULL, FALSE);
    GstRTSPServer *server = gst_rtsp_server_new();
    gst_rtsp_server_set_address(server, "192.168.2.96"); // Match user's specific IP
    gst_rtsp_server_set_service(server, std::to_string(port).c_str());
    gst_rtsp_server_set_backlog(server, 10);
    
    GstRTSPMountPoints *mounts = gst_rtsp_server_get_mount_points(server);
    GstRTSPMediaFactory *factory = gst_rtsp_media_factory_new();
    
    // Launch string: Video (pay0) + Metadata (pay1)
    // Video: RTP H264 -> Depay -> Repay (Standard)
    // Metadata: RAW KLV (UDP) -> Pay (Simpler, avoids depay issues)
    std::string launch_string = 
        "( "
        "udpsrc port=" + std::to_string(port) + " ! application/x-rtp,encoding-name=H264,payload=96 ! rtph264depay ! h264parse ! rtph264pay name=pay0 pt=96 "
        "udpsrc port=" + std::to_string(meta_port) + " ! meta/x-klv,parsed=true ! rtpklvpay name=pay1 pt=98 "
        ")";

    gst_rtsp_media_factory_set_launch(factory, launch_string.c_str());
    gst_rtsp_media_factory_set_shared(factory, TRUE); 
    gst_rtsp_mount_points_add_factory(mounts, "/test", factory);
    g_object_unref(mounts);
    
    gst_rtsp_server_attach(server, NULL);
    
    std::cout << "RTSP Server running at rtsp://192.168.2.96:" << port << "/test" << std::endl;
    std::cout << "Expecting Video RTP on port " << port << std::endl;
    std::cout << "Expecting Meta  RAW on port " << meta_port << std::endl;

    std::thread serverloopthread(g_main_loop_run, serverloop);

    // ---------------------------------------------------------
    // 2. Setup Metadata Writer Pipeline (GStreamer)
    // ---------------------------------------------------------
    // Sends RAW KLV data via UDP to localhost:meta_port
    // Removed rtpklvpay to send raw data
    std::string meta_pipeline_str = 
        "appsrc name=metasrc format=time ! meta/x-klv,parsed=true ! udpsink host=127.0.0.1 port=" + std::to_string(meta_port);
    
    GError *error = nullptr;
    GstElement *meta_pipeline = gst_parse_launch(meta_pipeline_str.c_str(), &error);
    if (!meta_pipeline) {
        std::cerr << "Failed to create metadata pipeline: " << error->message << std::endl;
        return -1;
    }
    
    meta_appsrc = gst_bin_get_by_name(GST_BIN(meta_pipeline), "metasrc");
    gst_element_set_state(meta_pipeline, GST_STATE_PLAYING);

    // ---------------------------------------------------------
    // 3. Setup Video Writer (OpenCV -> GStreamer)
    // ---------------------------------------------------------
    cv::VideoCapture video(video_path);
    if (!video.isOpened()) {
        std::cerr << "Failed to open video file: " << video_path << std::endl;
        return -1;
    }

    video.set(cv::CAP_PROP_FRAME_WIDTH, 1920);
    video.set(cv::CAP_PROP_FRAME_HEIGHT, 1080);
    video.set(cv::CAP_PROP_FPS, 30);

    float fps = 30.0;
    int w = 1920;
    int h = 1080;
    cv::Size frameSize(w, h);

    // Sends H264 RTP to localhost:port
    std::string video_pipeline = 
        "appsrc ! queue ! videoconvert ! video/x-raw,format=I420 ! x264enc key-int-max=30 insert-vui=1 tune=zerolatency ! h264parse ! rtph264pay ! udpsink host=127.0.0.1 port=" + std::to_string(port);
    
    cv::VideoWriter rtph264_writer(video_pipeline, cv::CAP_GSTREAMER, 0, fps, frameSize);
    if (!rtph264_writer.isOpened()) {
        std::cerr << "Failed to open video writer." << std::endl;
        return -1;
    }

    // ---------------------------------------------------------
    // 4. Main Loop
    // ---------------------------------------------------------
    std::cout << "Starting streaming..." << std::endl;
    
    int frame_count = 0;
    GstClockTime timestamp = 0;
    GstClockTime duration = (GstClockTime)(GST_SECOND / fps);

    while (true) {
        cv::Mat frame;
        video.set(cv::CAP_PROP_POS_FRAMES, 0); // Loop video

        while (true) {
            auto start_time = std::chrono::steady_clock::now();

            video >> frame;
            if (frame.empty()) break;

            cv::resize(frame, frame, frameSize);
            
            // Write Video Frame
            rtph264_writer.write(frame);

            // Write Metadata (every frame or periodically)
            // Emit a valid ST 0601 UAS Datalink Local Set: tag 2 (Precision Time Stamp,
            // Unix microseconds) is the field the VRM sync/drift metrics key on, plus
            // the version (tag 65) and the ST 0601 checksum (tag 1) that any STANAG 4609
            // consumer verifies. misb::st0601::Builder adds tags 2, 65 and 1 for us.
            uint64_t unix_us = std::chrono::duration_cast<std::chrono::microseconds>(
                std::chrono::system_clock::now().time_since_epoch()).count();
            misb::st0601::Builder meta_builder(unix_us);
            std::vector<uint8_t> klv_packet = meta_builder.finish();

            GstBuffer *buffer = gst_buffer_new_allocate(NULL, klv_packet.size(), NULL);
            gst_buffer_fill(buffer, 0, klv_packet.data(), klv_packet.size());
            
            GST_BUFFER_PTS(buffer) = timestamp;
            GST_BUFFER_DURATION(buffer) = duration;
            
            GstFlowReturn ret;
            g_signal_emit_by_name(meta_appsrc, "push-buffer", buffer, &ret);
            gst_buffer_unref(buffer);

            if (ret != GST_FLOW_OK) {
                // std::cerr << "Error pushing meta buffer" << std::endl;
            }

            timestamp += duration;
            frame_count++;

            // Control FPS
            auto end_time = std::chrono::steady_clock::now();
            auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(end_time - start_time).count();
            int sleep_ms = (1000 / fps) - elapsed;
            if (sleep_ms > 0) {
                std::this_thread::sleep_for(std::chrono::milliseconds(sleep_ms));
            }
        }
    }

    rtph264_writer.release();
    video.release();
    gst_element_set_state(meta_pipeline, GST_STATE_NULL);
    gst_object_unref(meta_pipeline);
    
    return 0;
}
