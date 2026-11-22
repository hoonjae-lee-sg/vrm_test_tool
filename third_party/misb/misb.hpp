// misb.hpp - MISB KLV metadata for drone video (STANAG 4609), single header, C++17.
//
//   ST 0601  UAS Datalink Local Set (all 143 tags of ST 0601.19)
//   ST 0102  Security Local Set (nested in tag 48)
//   ST 0903  VMTI Local Set and VTarget packs (nested in tag 74 or standalone)
//   ST 1201  IMAPB
//
// Zero-copy decoding with checksum verification; every length is checked
// against the input, so corrupt data returns an error instead of reading
// out of bounds. Encoding with misb::st0601::Builder and misb::st0903::Builder.
// Weapons-related ST 0601 items (tags 60, 61, 62, 140) are passed through
// as raw bytes and never interpreted.
//
// C++ port of the Rust crate `misb` (https://github.com/Mattbusel/misb),
// checked against the same reference data. MIT OR Apache-2.0.
//
//   #include "misb.hpp"
//   misb::Error err;
//   auto p = misb::st0601::Packet::parse(buf, len, &err);
//   if (p) {
//       if (auto fc = p->frame_center()) printf("%f %f\n", fc->lat, fc->lon);
//       for (auto item : p->items()) printf("%u %s\n", item.tag, misb::st0601::tag_name(item.tag));
//   }
#ifndef MISB_HPP
#define MISB_HPP

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace misb {

inline constexpr int version_major = 0, version_minor = 1, version_patch = 1;

enum class Error {
    none = 0,
    truncated,         // input ends inside a key, length or value
    bad_length,        // malformed BER length or BER-OID
    wrong_key,         // not the expected 16-byte universal key
    missing_checksum,  // packet does not end with tag 1, length 2
    checksum,          // checksum mismatch
    bad_value,         // wrong type or length for the tag (encoding)
    out_of_range,      // value outside the tag's range (encoding)
};

inline const char* to_string(Error e) {
    switch (e) {
        case Error::none: return "ok";
        case Error::truncated: return "KLV data ends early";
        case Error::bad_length: return "malformed BER length or tag";
        case Error::wrong_key: return "unexpected universal key";
        case Error::missing_checksum: return "packet does not end with a checksum item";
        case Error::checksum: return "checksum mismatch";
        case Error::bad_value: return "value has the wrong type or length";
        case Error::out_of_range: return "value outside the range the tag can carry";
    }
    return "unknown";
}

struct GeoPoint {
    double lat = 0, lon = 0;
    std::optional<double> height;
};

// Read-only byte range. Not std::basic_string_view<uint8_t>: libc++ 19 (Xcode 16.3+,
// Emscripten, Android NDK r28) dropped std::char_traits<unsigned char>, so that type
// no longer compiles there.
class bytes_view {
public:
    constexpr bytes_view() = default;
    constexpr bytes_view(const uint8_t* p, size_t n) : p_(p), n_(n) {}
    constexpr const uint8_t* data() const { return p_; }
    constexpr size_t size() const { return n_; }
    constexpr bool empty() const { return n_ == 0; }
    constexpr const uint8_t* begin() const { return p_; }
    constexpr const uint8_t* end() const { return p_ + n_; }
    constexpr uint8_t operator[](size_t i) const { return p_[i]; }
    // Clamped to the range instead of throwing.
    constexpr bytes_view substr(size_t pos, size_t n = static_cast<size_t>(-1)) const {
        if (pos > n_) pos = n_;
        return bytes_view(p_ + pos, n < n_ - pos ? n : n_ - pos);
    }
private:
    const uint8_t* p_ = nullptr;
    size_t n_ = 0;
};

namespace klv {

inline constexpr uint8_t ul_prefix[4] = {0x06, 0x0E, 0x2B, 0x34};

// BER length at p (n bytes available). Returns false on error.
inline bool read_ber_length(const uint8_t* p, size_t n, size_t& len, size_t& used, Error* err = nullptr) {
    auto fail = [&](Error e) { if (err) *err = e; return false; };
    if (n == 0) return fail(Error::truncated);
    if (p[0] < 0x80) { len = p[0]; used = 1; return true; }
    size_t k = p[0] & 0x7F;
    if (k == 0 || k > 4) return fail(Error::bad_length);
    if (n < 1 + k) return fail(Error::truncated);
    uint64_t v = 0;
    for (size_t i = 0; i < k; ++i) v = (v << 8) | p[1 + i];
    if (v > SIZE_MAX) return fail(Error::bad_length);
    len = static_cast<size_t>(v);
    used = 1 + k;
    return true;
}

inline bool read_ber_oid(const uint8_t* p, size_t n, uint64_t& v, size_t& used, Error* err = nullptr) {
    v = 0;
    for (size_t i = 0; i < n; ++i) {
        if (i == 9) { if (err) *err = Error::bad_length; return false; }
        v = (v << 7) | (p[i] & 0x7F);
        if (!(p[i] & 0x80)) { used = i + 1; return true; }
    }
    if (err) *err = Error::truncated;
    return false;
}

inline void push_ber_length(std::vector<uint8_t>& out, size_t len) {
    if (len < 0x80) { out.push_back(static_cast<uint8_t>(len)); return; }
    int n = 0;
    for (uint64_t v = len; v; v >>= 8) ++n;
    out.push_back(static_cast<uint8_t>(0x80 | n));
    for (int i = n - 1; i >= 0; --i) out.push_back(static_cast<uint8_t>(uint64_t(len) >> (8 * i)));
}

inline void push_ber_oid(std::vector<uint8_t>& out, uint64_t v) {
    int n = 1;
    while (n < 9 && (v >> (7 * n))) ++n;
    for (int i = n - 1; i >= 0; --i) out.push_back(static_cast<uint8_t>(((v >> (7 * i)) & 0x7F) | (i ? 0x80 : 0)));
}

// 16-bit running sum of ST 0601 / ST 0903 tag 1: covers the packet from the
// key through the checksum item's length byte (everything but the last 2 bytes).
inline uint16_t checksum(const uint8_t* p, size_t n) {
    uint16_t bcc = 0;
    for (size_t i = 0; i < n; ++i) bcc = static_cast<uint16_t>(bcc + (uint16_t(p[i]) << (8 * ((i + 1) % 2))));
    return bcc;
}

inline std::optional<uint64_t> be_uint(bytes_view b) {
    if (b.empty() || b.size() > 8) return std::nullopt;
    uint64_t v = 0;
    for (uint8_t x : b) v = (v << 8) | x;
    return v;
}

inline std::optional<int64_t> be_int(bytes_view b) {
    auto u = be_uint(b);
    if (!u) return std::nullopt;
    unsigned bits = 8u * unsigned(b.size());
    if (bits == 64) return static_cast<int64_t>(*u);
    uint64_t sign = uint64_t(1) << (bits - 1);
    return static_cast<int64_t>((*u ^ sign)) - static_cast<int64_t>(sign);
}

struct Item {
    uint32_t tag = 0;
    bytes_view value;
};

// Range over the items of a local set body. Iteration stops at the end or at
// the first malformed item; error() tells which.
class Items {
public:
    explicit Items(bytes_view body) : body_(body) {}
    class iterator {
    public:
        iterator() = default;  // the end iterator
        iterator(const Items* owner, bytes_view rest) : owner_(owner), rest_(rest), done_(false) { advance(); }
        const Item& operator*() const { return cur_; }
        const Item* operator->() const { return &cur_; }
        iterator& operator++() { advance(); return *this; }
        bool operator==(const iterator& o) const { return done_ == o.done_ && (done_ || rest_.data() == o.rest_.data()); }
        bool operator!=(const iterator& o) const { return !(*this == o); }
    private:
        void advance() {
            if (rest_.empty()) { done_ = true; return; }
            Error e = Error::none;
            uint64_t tag = 0; size_t n = 0, len = 0, m = 0;
            if (!read_ber_oid(rest_.data(), rest_.size(), tag, n, &e) || tag > 0xFFFFFFFFu ||
                !read_ber_length(rest_.data() + n, rest_.size() - n, len, m, &e) || len > rest_.size() - n - m) {
                if (e == Error::none) e = tag > 0xFFFFFFFFu ? Error::bad_length : Error::truncated;
                if (owner_) owner_->err_ = e;
                done_ = true;
                return;
            }
            cur_ = Item{static_cast<uint32_t>(tag), rest_.substr(n + m, len)};
            rest_ = rest_.substr(n + m + len);
        }
        const Items* owner_ = nullptr;
        bytes_view rest_;
        Item cur_;
        bool done_ = true;
    };
    iterator begin() const { err_ = Error::none; return iterator(this, body_); }
    iterator end() const { return iterator(); }
    Error error() const { return err_; }
    std::optional<bytes_view> find(uint32_t tag) const {
        for (auto& i : *this) if (i.tag == tag) return i.value;
        return std::nullopt;
    }
private:
    bytes_view body_;
    mutable Error err_ = Error::none;
};

struct Unit {
    const uint8_t* key = nullptr;  // 16 bytes
    bytes_view value;
    bytes_view raw;  // key + length + value
};

// Splits a raw KLV stream (for example `ffmpeg -map 0:d -c copy -f data`)
// into units, skipping bytes that are not a universal key.
inline std::vector<Unit> split(const uint8_t* p, size_t n) {
    std::vector<Unit> out;
    size_t i = 0;
    while (i + 17 <= n) {
        if (std::memcmp(p + i, ul_prefix, 4) != 0) { ++i; continue; }
        size_t len, m;
        if (!read_ber_length(p + i + 16, n - i - 16, len, m) || len > n - i - 16 - m) { ++i; continue; }
        out.push_back(Unit{p + i, bytes_view(p + i + 16 + m, len), bytes_view(p + i, 16 + m + len)});
        i += 16 + m + len;
    }
    return out;
}

// Checks key, BER length and (optionally) the trailing checksum item.
inline std::optional<bytes_view> parse_checked(const uint8_t* p, size_t n, const uint8_t* key, bool verify,
                                               size_t* used, Error* err) {
    auto fail = [&](Error e) -> std::optional<bytes_view> { if (err) *err = e; return std::nullopt; };
    if (n < 16) return fail(Error::truncated);
    // Byte 8 of a universal key (index 7) is the registry version: not used for matching.
    if (std::memcmp(p, key, 7) != 0 || std::memcmp(p + 8, key + 8, 8) != 0) return fail(Error::wrong_key);
    size_t len, m;
    Error e = Error::none;
    if (!read_ber_length(p + 16, n - 16, len, m, &e)) return fail(e);
    if (len > n - 16 - m) return fail(Error::truncated);
    size_t end = 16 + m + len;
    if (verify) {
        if (len < 4 || p[end - 4] != 0x01 || p[end - 3] != 0x02) return fail(Error::missing_checksum);
        uint16_t found = static_cast<uint16_t>((p[end - 2] << 8) | p[end - 1]);
        if (found != checksum(p, end - 2)) return fail(Error::checksum);
    }
    if (used) *used = end;
    if (err) *err = Error::none;
    return bytes_view(p + 16 + m, len);
}

inline std::vector<uint8_t> finish_with_checksum(const uint8_t* key, const std::vector<uint8_t>& body) {
    std::vector<uint8_t> out(key, key + 16);
    push_ber_length(out, body.size() + 4);
    out.insert(out.end(), body.begin(), body.end());
    out.push_back(0x01);
    out.push_back(0x02);
    uint16_t c = checksum(out.data(), out.size());
    out.push_back(static_cast<uint8_t>(c >> 8));
    out.push_back(static_cast<uint8_t>(c));
    return out;
}

inline void push_item(std::vector<uint8_t>& out, uint32_t tag, bytes_view v) {
    push_ber_oid(out, tag);
    push_ber_length(out, v.size());
    out.insert(out.end(), v.begin(), v.end());
}

inline std::vector<uint8_t> min_uint(uint64_t v) {
    std::vector<uint8_t> b;
    int n = 1;
    while (n < 8 && (v >> (8 * n))) ++n;
    for (int i = n - 1; i >= 0; --i) b.push_back(static_cast<uint8_t>(v >> (8 * i)));
    return b;
}

}  // namespace klv

// ST 1201 IMAPB.
namespace imapb {

struct Scales { double sf, sr, z; };

inline std::optional<Scales> scales(double min, double max, size_t len) {
    if (len < 1 || len > 8 || !(max > min) || !std::isfinite(min) || !std::isfinite(max)) return std::nullopt;
    int b_pow = static_cast<int>(std::ceil(std::log2(max - min)));
    int d_pow = 8 * static_cast<int>(len) - 1;
    double sf = std::ldexp(1.0, d_pow - b_pow), sr = std::ldexp(1.0, b_pow - d_pow);
    double z = 0;
    if (min < 0 && max > 0) z = sf * min - std::floor(sf * min);
    return Scales{sf, sr, z};
}

// nullopt for special values (two top bits set), integers above max and bad lengths.
inline std::optional<double> decode(double min, double max, bytes_view b) {
    auto s = scales(min, max, b.size());
    auto y = klv::be_uint(b);
    if (!s || !y) return std::nullopt;
    unsigned bits = 8u * unsigned(b.size());
    if (((*y >> (bits - 2)) & 3u) == 3u) return std::nullopt;
    double x = s->sr * (double(*y) - s->z) + min;
    if (x > max + s->sr) return std::nullopt;
    return x;
}

inline bool encode(double min, double max, double x, uint8_t* out, size_t len) {
    auto s = scales(min, max, len);
    if (!s || !std::isfinite(x) || x < min || x > max) return false;
    uint64_t y = static_cast<uint64_t>(std::floor(s->sf * (x - min) + s->z));
    for (size_t i = 0; i < len; ++i) out[i] = static_cast<uint8_t>(y >> (8 * (len - 1 - i)));
    return true;
}

}  // namespace imapb

namespace st0102 {

enum class Classification : uint8_t { unclassified = 1, restricted = 2, confidential = 3, secret = 4, top_secret = 5 };

inline const char* to_string(uint8_t c) {
    switch (c) {
        case 1: return "UNCLASSIFIED";
        case 2: return "RESTRICTED";
        case 3: return "CONFIDENTIAL";
        case 4: return "SECRET";
        case 5: return "TOP SECRET";
    }
    return "UNKNOWN";
}

class SecuritySet {
public:
    explicit SecuritySet(bytes_view body) : body_(body) {}
    klv::Items items() const { return klv::Items(body_); }
    std::optional<bytes_view> raw(uint32_t tag) const { return items().find(tag); }
    std::optional<uint8_t> classification() const {
        auto r = raw(1);
        if (!r || r->size() != 1) return std::nullopt;
        return (*r)[0];
    }
    std::optional<std::string_view> text(uint32_t tag) const {
        auto r = raw(tag);
        if (!r) return std::nullopt;
        return std::string_view(reinterpret_cast<const char*>(r->data()), r->size());
    }
    // Object Country Codes (tag 13) as UTF-8: UTF-16BE in current versions, single-byte before.
    std::optional<std::string> object_country_codes() const {
        auto r = raw(13);
        if (!r) return std::nullopt;
        bool utf16 = !r->empty() && r->size() % 2 == 0;
        for (size_t i = 0; utf16 && i < r->size(); i += 2) utf16 = (*r)[i] == 0;
        std::string s;
        if (utf16) for (size_t i = 1; i < r->size(); i += 2) s.push_back(static_cast<char>((*r)[i]));
        else s.assign(reinterpret_cast<const char*>(r->data()), r->size());
        return s;
    }
    std::optional<uint64_t> version() const {
        auto r = raw(22);
        return r ? klv::be_uint(*r) : std::nullopt;
    }
private:
    bytes_view body_;
};

}  // namespace st0102

namespace st0903 {

inline constexpr uint8_t key[16] = {0x06, 0x0E, 0x2B, 0x34, 0x02, 0x0B, 0x01, 0x01,
                                    0x0E, 0x01, 0x03, 0x03, 0x06, 0x00, 0x00, 0x00};

struct VTarget {
    uint64_t id = 0;
    bytes_view body;

    klv::Items items() const { return klv::Items(body); }
    std::optional<uint64_t> uint(uint32_t tag) const {
        auto r = items().find(tag);
        return r ? klv::be_uint(*r) : std::nullopt;
    }
    std::optional<uint64_t> centroid_pixel() const { return uint(1); }
    std::optional<uint8_t> confidence() const { auto v = uint(5); return v ? std::optional<uint8_t>(uint8_t(*v)) : std::nullopt; }
    std::optional<uint8_t> priority() const { auto v = uint(4); return v ? std::optional<uint8_t>(uint8_t(*v)) : std::nullopt; }
    // Target Location pack (tag 17).
    std::optional<GeoPoint> location() const {
        auto p = items().find(17);
        if (!p || p->size() < 10) return std::nullopt;
        auto lat = imapb::decode(-90, 90, p->substr(0, 4));
        auto lon = imapb::decode(-180, 180, p->substr(4, 4));
        if (!lat || !lon) return std::nullopt;
        return GeoPoint{*lat, *lon, imapb::decode(-900, 19000, p->substr(8, 2))};
    }
    // Offsets from the frame center (tags 10, 11), degrees.
    std::optional<std::pair<double, double>> location_offset() const {
        auto a = items().find(10), b = items().find(11);
        if (!a || !b) return std::nullopt;
        auto la = imapb::decode(-19.2, 19.2, *a), lo = imapb::decode(-19.2, 19.2, *b);
        if (!la || !lo) return std::nullopt;
        return std::make_pair(*la, *lo);
    }
};

inline std::optional<std::pair<uint64_t, uint64_t>> pixel_to_row_col(uint64_t pixel, uint64_t width) {
    if (pixel == 0 || width == 0) return std::nullopt;
    return std::make_pair((pixel - 1) / width + 1, (pixel - 1) % width + 1);
}

class VmtiSet {
public:
    explicit VmtiSet(bytes_view body) : body_(body) {}
    static std::optional<VmtiSet> parse(const uint8_t* p, size_t n, Error* err = nullptr, size_t* used = nullptr) {
        auto b = klv::parse_checked(p, n, key, true, used, err);
        return b ? std::optional<VmtiSet>(VmtiSet(*b)) : std::nullopt;
    }
    klv::Items items() const { return klv::Items(body_); }
    std::optional<uint64_t> uint(uint32_t tag) const {
        auto r = items().find(tag);
        return r ? klv::be_uint(*r) : std::nullopt;
    }
    std::optional<uint64_t> timestamp() const { return uint(2); }
    std::optional<uint64_t> frame_width() const { return uint(8); }
    std::optional<uint64_t> frame_height() const { return uint(9); }
    std::optional<double> horizontal_fov() const { auto r = items().find(11); return r ? imapb::decode(0, 180, *r) : std::nullopt; }
    // VTarget packs of tag 101. Stops at the first malformed pack.
    std::vector<VTarget> targets(Error* err = nullptr) const {
        std::vector<VTarget> out;
        auto series = items().find(101);
        if (!series) return out;
        bytes_view rest = *series;
        while (!rest.empty()) {
            size_t len, m, k;
            uint64_t id;
            Error e = Error::none;
            if (!klv::read_ber_length(rest.data(), rest.size(), len, m, &e) || len > rest.size() - m) {
                if (err) *err = e == Error::none ? Error::truncated : e;
                break;
            }
            bytes_view pack = rest.substr(m, len);
            rest = rest.substr(m + len);
            if (!klv::read_ber_oid(pack.data(), pack.size(), id, k, &e)) { if (err) *err = e; break; }
            out.push_back(VTarget{id, pack.substr(k)});
        }
        return out;
    }
private:
    bytes_view body_;
};

}  // namespace st0903

namespace st0601 {

inline constexpr uint8_t key[16] = {0x06, 0x0E, 0x2B, 0x34, 0x02, 0x0B, 0x01, 0x01,
                                    0x0E, 0x01, 0x03, 0x01, 0x01, 0x00, 0x00, 0x00};
inline constexpr uint64_t version = 19;

enum class Kind : uint8_t { text, time, uint, sint, linear, imapb, security, vmti, bytes };

struct TagInfo {
    uint32_t tag;
    const char* name;
    const char* units;
    Kind kind;
    uint8_t len;  // linear: byte length; imapb: default encode length
    bool is_signed;
    double min, max;
};

#define MISB_T(n, name, u) {n, name, u, Kind::text, 0, false, 0, 0}
#define MISB_TM(n, name) {n, name, "us", Kind::time, 8, false, 0, 0}
#define MISB_U(n, name, u) {n, name, u, Kind::uint, 0, false, 0, 0}
#define MISB_I(n, name, u) {n, name, u, Kind::sint, 0, true, 0, 0}
#define MISB_L(n, name, u, len, s, lo, hi) {n, name, u, Kind::linear, len, s, lo, hi}
#define MISB_M(n, name, u, lo, hi, len) {n, name, u, Kind::imapb, len, false, lo, hi}
#define MISB_B(n, name) {n, name, "", Kind::bytes, 0, false, 0, 0}

inline constexpr TagInfo tags[143] = {
    MISB_U(1, "Checksum", ""),
    MISB_TM(2, "Precision Time Stamp"),
    MISB_T(3, "Mission ID", ""),
    MISB_T(4, "Platform Tail Number", ""),
    MISB_L(5, "Platform Heading Angle", "deg", 2, false, 0, 360),
    MISB_L(6, "Platform Pitch Angle", "deg", 2, true, -20, 20),
    MISB_L(7, "Platform Roll Angle", "deg", 2, true, -50, 50),
    MISB_U(8, "Platform True Airspeed", "m/s"),
    MISB_U(9, "Platform Indicated Airspeed", "m/s"),
    MISB_T(10, "Platform Designation", ""),
    MISB_T(11, "Image Source Sensor", ""),
    MISB_T(12, "Image Coordinate System", ""),
    MISB_L(13, "Sensor Latitude", "deg", 4, true, -90, 90),
    MISB_L(14, "Sensor Longitude", "deg", 4, true, -180, 180),
    MISB_L(15, "Sensor True Altitude", "m", 2, false, -900, 19000),
    MISB_L(16, "Sensor Horizontal Field of View", "deg", 2, false, 0, 180),
    MISB_L(17, "Sensor Vertical Field of View", "deg", 2, false, 0, 180),
    MISB_L(18, "Sensor Relative Azimuth Angle", "deg", 4, false, 0, 360),
    MISB_L(19, "Sensor Relative Elevation Angle", "deg", 4, true, -180, 180),
    MISB_L(20, "Sensor Relative Roll Angle", "deg", 4, false, 0, 360),
    MISB_L(21, "Slant Range", "m", 4, false, 0, 5000000),
    MISB_L(22, "Target Width", "m", 2, false, 0, 10000),
    MISB_L(23, "Frame Center Latitude", "deg", 4, true, -90, 90),
    MISB_L(24, "Frame Center Longitude", "deg", 4, true, -180, 180),
    MISB_L(25, "Frame Center Elevation", "m", 2, false, -900, 19000),
    MISB_L(26, "Offset Corner Latitude Point 1", "deg", 2, true, -0.075, 0.075),
    MISB_L(27, "Offset Corner Longitude Point 1", "deg", 2, true, -0.075, 0.075),
    MISB_L(28, "Offset Corner Latitude Point 2", "deg", 2, true, -0.075, 0.075),
    MISB_L(29, "Offset Corner Longitude Point 2", "deg", 2, true, -0.075, 0.075),
    MISB_L(30, "Offset Corner Latitude Point 3", "deg", 2, true, -0.075, 0.075),
    MISB_L(31, "Offset Corner Longitude Point 3", "deg", 2, true, -0.075, 0.075),
    MISB_L(32, "Offset Corner Latitude Point 4", "deg", 2, true, -0.075, 0.075),
    MISB_L(33, "Offset Corner Longitude Point 4", "deg", 2, true, -0.075, 0.075),
    MISB_U(34, "Icing Detected", ""),
    MISB_L(35, "Wind Direction", "deg", 2, false, 0, 360),
    MISB_L(36, "Wind Speed", "m/s", 1, false, 0, 100),
    MISB_L(37, "Static Pressure", "mbar", 2, false, 0, 5000),
    MISB_L(38, "Density Altitude", "m", 2, false, -900, 19000),
    MISB_I(39, "Outside Air Temperature", "C"),
    MISB_L(40, "Target Location Latitude", "deg", 4, true, -90, 90),
    MISB_L(41, "Target Location Longitude", "deg", 4, true, -180, 180),
    MISB_L(42, "Target Location Elevation", "m", 2, false, -900, 19000),
    MISB_L(43, "Target Track Gate Width", "pixels", 1, false, 0, 510),
    MISB_L(44, "Target Track Gate Height", "pixels", 1, false, 0, 510),
    MISB_L(45, "Target Error Estimate - CE90", "m", 2, false, 0, 4095),
    MISB_L(46, "Target Error Estimate - LE90", "m", 2, false, 0, 4095),
    MISB_U(47, "Generic Flag Data", ""),
    {48, "Security Local Set", "", Kind::security, 0, false, 0, 0},
    MISB_L(49, "Differential Pressure", "mbar", 2, false, 0, 5000),
    MISB_L(50, "Platform Angle of Attack", "deg", 2, true, -20, 20),
    MISB_L(51, "Platform Vertical Speed", "m/s", 2, true, -180, 180),
    MISB_L(52, "Platform Sideslip Angle", "deg", 2, true, -20, 20),
    MISB_L(53, "Airfield Barometric Pressure", "mbar", 2, false, 0, 5000),
    MISB_L(54, "Airfield Elevation", "m", 2, false, -900, 19000),
    MISB_L(55, "Relative Humidity", "%", 1, false, 0, 100),
    MISB_U(56, "Platform Ground Speed", "m/s"),
    MISB_L(57, "Ground Range", "m", 4, false, 0, 5000000),
    MISB_L(58, "Platform Fuel Remaining", "kg", 2, false, 0, 10000),
    MISB_T(59, "Platform Call Sign", ""),
    MISB_B(60, "Weapon Load (not interpreted)"),
    MISB_B(61, "Weapon Fired (not interpreted)"),
    MISB_B(62, "Laser PRF Code (not interpreted)"),
    MISB_U(63, "Sensor Field of View Name", ""),
    MISB_L(64, "Platform Magnetic Heading", "deg", 2, false, 0, 360),
    MISB_U(65, "UAS Datalink LS Version Number", ""),
    MISB_B(66, "Deprecated (Target Location Covariance Matrix)"),
    MISB_L(67, "Alternate Platform Latitude", "deg", 4, true, -90, 90),
    MISB_L(68, "Alternate Platform Longitude", "deg", 4, true, -180, 180),
    MISB_L(69, "Alternate Platform Altitude", "m", 2, false, -900, 19000),
    MISB_T(70, "Alternate Platform Name", ""),
    MISB_L(71, "Alternate Platform Heading", "deg", 2, false, 0, 360),
    MISB_TM(72, "Event Start Time - UTC"),
    MISB_B(73, "RVT Local Set (ST 0806)"),
    {74, "VMTI Local Set (ST 0903)", "", Kind::vmti, 0, false, 0, 0},
    MISB_L(75, "Sensor Ellipsoid Height", "m", 2, false, -900, 19000),
    MISB_L(76, "Alternate Platform Ellipsoid Height", "m", 2, false, -900, 19000),
    MISB_U(77, "Operational Mode", ""),
    MISB_L(78, "Frame Center Height Above Ellipsoid", "m", 2, false, -900, 19000),
    MISB_L(79, "Sensor North Velocity", "m/s", 2, true, -327, 327),
    MISB_L(80, "Sensor East Velocity", "m/s", 2, true, -327, 327),
    MISB_B(81, "Image Horizon Pixel Pack"),
    MISB_L(82, "Corner Latitude Point 1 (Full)", "deg", 4, true, -90, 90),
    MISB_L(83, "Corner Longitude Point 1 (Full)", "deg", 4, true, -180, 180),
    MISB_L(84, "Corner Latitude Point 2 (Full)", "deg", 4, true, -90, 90),
    MISB_L(85, "Corner Longitude Point 2 (Full)", "deg", 4, true, -180, 180),
    MISB_L(86, "Corner Latitude Point 3 (Full)", "deg", 4, true, -90, 90),
    MISB_L(87, "Corner Longitude Point 3 (Full)", "deg", 4, true, -180, 180),
    MISB_L(88, "Corner Latitude Point 4 (Full)", "deg", 4, true, -90, 90),
    MISB_L(89, "Corner Longitude Point 4 (Full)", "deg", 4, true, -180, 180),
    MISB_L(90, "Platform Pitch Angle (Full)", "deg", 4, true, -90, 90),
    MISB_L(91, "Platform Roll Angle (Full)", "deg", 4, true, -90, 90),
    MISB_L(92, "Platform Angle of Attack (Full)", "deg", 4, true, -90, 90),
    MISB_L(93, "Platform Sideslip Angle (Full)", "deg", 4, true, -180, 180),
    MISB_B(94, "MIIS Core Identifier (ST 1204)"),
    MISB_B(95, "SAR Motion Imagery Local Set (ST 1206)"),
    MISB_M(96, "Target Width Extended", "m", 0, 1500000, 3),
    MISB_B(97, "Range Image Local Set (ST 1002)"),
    MISB_B(98, "Geo-Registration Local Set (ST 1601)"),
    MISB_B(99, "Composite Imaging Local Set (ST 1602)"),
    MISB_B(100, "Segment Local Set (ST 1607)"),
    MISB_B(101, "Amend Local Set (ST 1607)"),
    MISB_B(102, "SDCC-FLP (ST 1010)"),
    MISB_M(103, "Density Altitude Extended", "m", -900, 40000, 3),
    MISB_M(104, "Sensor Ellipsoid Height Extended", "m", -900, 40000, 3),
    MISB_M(105, "Alternate Platform Ellipsoid Height Extended", "m", -900, 40000, 3),
    MISB_T(106, "Stream Designator", ""),
    MISB_T(107, "Operational Base", ""),
    MISB_T(108, "Broadcast Source", ""),
    MISB_M(109, "Range To Recovery Location", "km", 0, 21000, 3),
    MISB_U(110, "Time Airborne", "s"),
    MISB_U(111, "Propulsion Unit Speed", "rpm"),
    MISB_M(112, "Platform Course Angle", "deg", 0, 360, 2),
    MISB_M(113, "Altitude Above Ground Level (AGL)", "m", -900, 40000, 3),
    MISB_M(114, "Radar Altimeter", "m", -900, 40000, 3),
    MISB_B(115, "Control Command"),
    MISB_B(116, "Control Command Verification List"),
    MISB_M(117, "Sensor Azimuth Rate", "deg/s", -1000, 1000, 3),
    MISB_M(118, "Sensor Elevation Rate", "deg/s", -1000, 1000, 3),
    MISB_M(119, "Sensor Roll Rate", "deg/s", -1000, 1000, 3),
    MISB_M(120, "On-board MI Storage Percent Full", "%", 0, 100, 2),
    MISB_B(121, "Active Wavelength List"),
    MISB_B(122, "Country Codes"),
    MISB_U(123, "Number of NAVSATs in View", ""),
    MISB_U(124, "Positioning Method Source", ""),
    MISB_U(125, "Platform Status", ""),
    MISB_U(126, "Sensor Control Mode", ""),
    MISB_B(127, "Sensor Frame Rate Pack"),
    MISB_B(128, "Wavelengths List"),
    MISB_T(129, "Target ID", ""),
    MISB_B(130, "Airbase Locations"),
    MISB_TM(131, "Take-off Time"),
    MISB_M(132, "Transmission Frequency", "MHz", 1, 99999, 3),
    MISB_U(133, "On-board MI Storage Capacity", "GB"),
    MISB_M(134, "Zoom Percentage", "%", 0, 100, 2),
    MISB_T(135, "Communications Method", ""),
    MISB_I(136, "Leap Seconds", "s"),
    MISB_I(137, "Correction Offset", "us"),
    MISB_B(138, "Payload List"),
    MISB_B(139, "Active Payloads"),
    MISB_B(140, "Weapons Stores (not interpreted)"),
    MISB_B(141, "Waypoint List"),
    MISB_B(142, "View Domain"),
    MISB_B(143, "Metadata Substream ID Pack"),
};

#undef MISB_T
#undef MISB_TM
#undef MISB_U
#undef MISB_I
#undef MISB_L
#undef MISB_M
#undef MISB_B

inline const TagInfo* tag_info(uint32_t tag) {
    return (tag >= 1 && tag <= 143) ? &tags[tag - 1] : nullptr;
}
inline const char* tag_name(uint32_t tag) {
    auto t = tag_info(tag);
    return t ? t->name : "Unknown";
}

enum class Status { ok, missing, out_of_range, invalid };

// A tag decoded to a number in its units (linear, IMAPB, integer and time tags).
struct Number {
    Status status = Status::missing;
    double value = 0;
    explicit operator bool() const { return status == Status::ok; }
};

inline Number decode_number(const TagInfo& t, bytes_view raw) {
    Number n;
    n.status = Status::invalid;
    if (raw.empty() || raw.size() > 8) return n;
    switch (t.kind) {
        case Kind::uint: n.value = double(*klv::be_uint(raw)); break;
        case Kind::sint: n.value = double(*klv::be_int(raw)); break;
        case Kind::time: if (t.tag == 2 && raw.size() != 8) return n; n.value = double(*klv::be_uint(raw)); break;
        case Kind::linear: {
            // Lengths other than the standard one are read as sent, on the standard scale.
            int bits = 8 * t.len;
            if (t.is_signed) {
                int64_t v = *klv::be_int(raw);
                if (raw.size() == t.len && v == -(int64_t(1) << (bits - 1))) { n.status = Status::out_of_range; return n; }
                n.value = double(v) * (t.max - t.min) / (std::ldexp(1.0, bits) - 2.0) + (t.max + t.min) / 2.0;
            } else {
                uint64_t v = *klv::be_uint(raw);
                n.value = double(v) * (t.max - t.min) / (std::ldexp(1.0, bits) - 1.0) + t.min;
            }
            break;
        }
        case Kind::imapb: {
            auto v = imapb::decode(t.min, t.max, raw);
            if (!v) { n.status = Status::out_of_range; return n; }
            n.value = *v;
            break;
        }
        default: return n;
    }
    n.status = Status::ok;
    return n;
}

class Packet {
public:
    // Checks key, length and checksum. `used` receives the packet size.
    static std::optional<Packet> parse(const uint8_t* p, size_t n, Error* err = nullptr, size_t* used = nullptr) {
        auto b = klv::parse_checked(p, n, key, true, used, err);
        return b ? std::optional<Packet>(Packet(*b)) : std::nullopt;
    }
    static std::optional<Packet> parse_unverified(const uint8_t* p, size_t n, Error* err = nullptr, size_t* used = nullptr) {
        auto b = klv::parse_checked(p, n, key, false, used, err);
        return b ? std::optional<Packet>(Packet(*b)) : std::nullopt;
    }
    explicit Packet(bytes_view body) : body_(body) {}

    bytes_view body() const { return body_; }
    klv::Items items() const { return klv::Items(body_); }
    std::optional<bytes_view> raw(uint32_t tag) const { return items().find(tag); }

    Number number(uint32_t tag) const {
        auto t = tag_info(tag);
        auto r = raw(tag);
        if (!t || !r) return Number{};
        return decode_number(*t, *r);
    }
    std::optional<double> value(uint32_t tag) const {
        auto n = number(tag);
        return n ? std::optional<double>(n.value) : std::nullopt;
    }
    std::optional<std::string_view> text(uint32_t tag) const {
        auto r = raw(tag);
        if (!r) return std::nullopt;
        return std::string_view(reinterpret_cast<const char*>(r->data()), r->size());
    }
    std::optional<uint64_t> timestamp() const {
        auto r = raw(2);
        return (r && r->size() == 8) ? klv::be_uint(*r) : std::nullopt;
    }
    std::optional<uint64_t> version() const {
        auto r = raw(65);
        return r ? klv::be_uint(*r) : std::nullopt;
    }
    std::optional<GeoPoint> point(uint32_t lat, uint32_t lon, uint32_t h) const {
        auto a = value(lat), b = value(lon);
        if (!a || !b) return std::nullopt;
        return GeoPoint{*a, *b, value(h)};
    }
    std::optional<GeoPoint> sensor_position() const { return point(13, 14, 15); }
    std::optional<GeoPoint> frame_center() const { return point(23, 24, 25); }
    std::optional<GeoPoint> target_location() const { return point(40, 41, 42); }
    // Footprint corners: full tags 82-89 when all present, else offsets 26-33 from the frame center.
    std::optional<std::array<GeoPoint, 4>> corners() const {
        std::array<GeoPoint, 4> out{};
        bool full = true;
        for (int i = 0; i < 4 && full; ++i) {
            auto a = value(82 + 2 * i), b = value(83 + 2 * i);
            if (a && b) out[i] = GeoPoint{*a, *b, std::nullopt}; else full = false;
        }
        if (full) return out;
        auto fc = frame_center();
        if (!fc) return std::nullopt;
        for (int i = 0; i < 4; ++i) {
            auto a = value(26 + 2 * i), b = value(27 + 2 * i);
            if (!a || !b) return std::nullopt;
            out[i] = GeoPoint{fc->lat + *a, fc->lon + *b, std::nullopt};
        }
        return out;
    }
    std::optional<st0102::SecuritySet> security() const {
        auto r = raw(48);
        return r ? std::optional<st0102::SecuritySet>(st0102::SecuritySet(*r)) : std::nullopt;
    }
    std::optional<st0903::VmtiSet> vmti() const {
        auto r = raw(74);
        return r ? std::optional<st0903::VmtiSet>(st0903::VmtiSet(*r)) : std::nullopt;
    }

private:
    bytes_view body_;
};

// Encodes a UAS Datalink Local Set packet. finish() adds the version (tag 65,
// unless set) and the checksum.
class Builder {
public:
    explicit Builder(uint64_t timestamp_us) {
        uint8_t b[8];
        for (int i = 0; i < 8; ++i) b[i] = static_cast<uint8_t>(timestamp_us >> (56 - 8 * i));
        klv::push_item(body_, 2, bytes_view(b, 8));
    }
    Error raw(uint32_t tag, bytes_view v) {
        if (tag == 1) return Error::bad_value;
        if (tag == 65) has_version_ = true;
        klv::push_item(body_, tag, v);
        return Error::none;
    }
    Error number(uint32_t tag, double v) {
        auto t = tag_info(tag);
        if (!t) return Error::bad_value;
        uint8_t b[8];
        switch (t->kind) {
            case Kind::linear: {
                if (!std::isfinite(v) || v < t->min || v > t->max) return Error::out_of_range;
                int bits = 8 * t->len;
                uint64_t raw;
                if (t->is_signed) {
                    double span = std::ldexp(1.0, bits) - 2.0;
                    raw = static_cast<uint64_t>(static_cast<int64_t>(std::round((v - (t->max + t->min) / 2) * span / (t->max - t->min))));
                } else {
                    double span = std::ldexp(1.0, bits) - 1.0;
                    raw = static_cast<uint64_t>(std::round((v - t->min) * span / (t->max - t->min)));
                }
                for (int i = 0; i < t->len; ++i) b[i] = static_cast<uint8_t>(raw >> (8 * (t->len - 1 - i)));
                return raw_(tag, bytes_view(b, t->len));
            }
            case Kind::imapb:
                if (!imapb::encode(t->min, t->max, v, b, t->len)) return Error::out_of_range;
                return raw_(tag, bytes_view(b, t->len));
            case Kind::uint: {
                if (v < 0 || v != std::floor(v) || v >= 1.8e19) return Error::bad_value;
                auto m = klv::min_uint(static_cast<uint64_t>(v));
                return raw_(tag, bytes_view(m.data(), m.size()));
            }
            default: return Error::bad_value;
        }
    }
    Error text(uint32_t tag, std::string_view s) {
        auto t = tag_info(tag);
        if (!t || t->kind != Kind::text || s.size() > 127) return Error::bad_value;
        return raw_(tag, bytes_view(reinterpret_cast<const uint8_t*>(s.data()), s.size()));
    }
    std::vector<uint8_t> finish() const {
        auto body = body_;
        if (!has_version_) {
            uint8_t v = static_cast<uint8_t>(version);
            klv::push_item(body, 65, bytes_view(&v, 1));
        }
        return klv::finish_with_checksum(key, body);
    }
private:
    Error raw_(uint32_t tag, bytes_view v) { return raw(tag, v); }
    std::vector<uint8_t> body_;
    bool has_version_ = false;
};

}  // namespace st0601
}  // namespace misb

#endif  // MISB_HPP
