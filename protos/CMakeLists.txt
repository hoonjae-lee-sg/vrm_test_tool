include(../cmake/protos.cmake)

message(STATUS "Generating ATFR core proto sources...")
message(STATUS "Proto files: ${ATFR_CORE_CONTRACTS_PROTOS}")
message(STATUS "Generated sources: ${ATFR_CORE_CONTRACTS_SRCS}")
message(STATUS "proto include directories: ${CMAKE_CURRENT_BINARY_DIR}/../generated")

add_library(atfr-core-proto STATIC
    ${ATFR_CORE_CONTRACTS_SRCS}
)

target_include_directories(atfr-core-proto PUBLIC
    ${CMAKE_BINARY_DIR}/generated
)

target_link_libraries(atfr-core-proto PUBLIC
    protobuf::libprotobuf
    gRPC::grpc++
)
