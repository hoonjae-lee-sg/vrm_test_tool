// Confirms the RTSP metadata stream now emits a valid ST 0601 UAS Datalink
// Local Set instead of raw JSON wrapped in the ST 0601 universal label.
//
// Before: rtsp_server_with_meta.cpp prepended the 16-byte ST 0601 UL and a BER
// length, then inserted a JSON string as the value. A STANAG 4609 consumer that
// keys off that UL reads the body as ST 0601 tag/length items and fails: there
// is no checksum item (tag 1), so parsing stops at Error::missing_checksum.
//
// After: misb::st0601::Builder emits the precision time stamp (tag 2), version
// (tag 65) and the ST 0601 checksum (tag 1), so the packet round-trips.

#include "misb/misb.hpp"
#include <cstdio>
#include <cstdint>
#include <string>
#include <vector>

static int failures = 0;
#define CHECK(cond, msg) do { if (!(cond)) { std::printf("FAIL: %s\n", msg); ++failures; } } while (0)

// The construction the server used before this change.
static std::vector<uint8_t> legacy_json_packet(const std::string& json_meta) {
    uint8_t klv_key[] = {0x06, 0x0E, 0x2B, 0x34, 0x02, 0x0B, 0x01, 0x01,
                         0x0E, 0x01, 0x03, 0x01, 0x01, 0x00, 0x00, 0x00};
    std::vector<uint8_t> p(std::begin(klv_key), std::end(klv_key));
    size_t value_len = json_meta.size();
    if (value_len < 128) {
        p.push_back((uint8_t)value_len);
    } else {
        p.push_back(0x81);
        p.push_back((uint8_t)value_len);
    }
    p.insert(p.end(), json_meta.begin(), json_meta.end());
    return p;
}

int main() {
    // Old payload: a valid ST 0601 UL followed by JSON, no checksum item.
    auto legacy = legacy_json_packet("{\"bbox\": [10, 20, 110, 120]}");
    misb::Error e = misb::Error::none;
    size_t used = 0;
    auto bad = misb::st0601::Packet::parse(legacy.data(), legacy.size(), &e, &used);
    CHECK(!bad.has_value(), "legacy JSON-in-UL packet must not parse as ST 0601");
    CHECK(e == misb::Error::missing_checksum || e == misb::Error::checksum
          || e == misb::Error::truncated || e == misb::Error::bad_length,
          "legacy packet should fail with a structural error");

    // New payload: built with misb::st0601::Builder, as the server now does.
    uint64_t unix_us = 1757049600000000ULL; // fixed for a deterministic test
    misb::st0601::Builder b(unix_us);
    std::vector<uint8_t> klv_packet = b.finish();

    misb::Error e2 = misb::Error::none;
    size_t used2 = 0;
    auto good = misb::st0601::Packet::parse(klv_packet.data(), klv_packet.size(), &e2, &used2);
    CHECK(good.has_value(), "Builder packet must parse as ST 0601");
    CHECK(e2 == misb::Error::none, "Builder packet must parse without error");
    if (good) {
        auto ts = good->timestamp();
        CHECK(ts.has_value() && *ts == unix_us, "precision time stamp (tag 2) must round-trip");
        CHECK(good->items().find(1).has_value(), "checksum item (tag 1) must be present");
    }

    if (failures == 0) {
        std::printf("ok: %zu-byte ST 0601 packet parses; legacy JSON packet rejected\n", klv_packet.size());
        return 0;
    }
    std::printf("%d check(s) failed\n", failures);
    return 1;
}
