cmake_minimum_required(VERSION 3.10)
project(vrm_rtsp_server)

set(CMAKE_CXX_STANDARD 17)

find_package(PkgConfig REQUIRED)
pkg_check_modules(GST gstreamer-1.0 gstreamer-rtsp-server-1.0)
find_package(OpenCV)

if (GST_FOUND AND OpenCV_FOUND)
    add_executable(rtsp_server_with_meta rtsp_server_with_meta.cpp)
    target_include_directories(rtsp_server_with_meta PRIVATE ${GST_INCLUDE_DIRS} ${OpenCV_INCLUDE_DIRS})
    target_link_libraries(rtsp_server_with_meta PRIVATE ${GST_LIBRARIES} ${OpenCV_LIBS})
    message(STATUS "Built rtsp_server_with_meta")
else()
    message(WARNING "GStreamer or OpenCV not found. Skipping rtsp_server_with_meta build. (Install libgstreamer-plugins-base1.0-dev libgstreamer-rtsp-server-1.0-dev libopencv-dev)")
endif()
