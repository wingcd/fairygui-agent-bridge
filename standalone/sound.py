"""Structural validation for MP3 and Ogg Vorbis resources.

These checks validate framing and container integrity; they do not decode audio.
"""
import io
import struct
import wave


def inspect_pcm_wav(data):
    try:
        with wave.open(io.BytesIO(data), 'rb') as sound:
            channels, sample_width, rate, frames = sound.getnchannels(), sound.getsampwidth(), sound.getframerate(), sound.getnframes()
            if sound.getcomptype() != 'NONE' or not channels or not sample_width or not rate or not frames:
                raise ValueError('invalid or empty PCM WAV')
            if len(sound.readframes(frames)) != frames * channels * sample_width: raise ValueError('truncated PCM WAV')
    except (wave.Error, EOFError, OSError, ValueError) as exc:
        raise ValueError('invalid or unsupported PCM WAV') from exc
    return {'format': 'wav-pcm', 'channels': channels, 'sample_rate': rate, 'frames': frames, 'sample_width': sample_width}


def inspect_sound(data, suffix):
    suffix = suffix.lower()
    if suffix == '.wav': return inspect_pcm_wav(data)
    if suffix == '.mp3': return inspect_mp3(data)
    if suffix == '.ogg': return inspect_ogg_vorbis(data)
    raise ValueError('unsupported audio extension')


def inspect_mp3(data):
    start, end = 0, len(data)
    if data.startswith(b'ID3'):
        if end < 10 or data[3] not in (2, 3, 4) or any(value & 0x80 for value in data[6:10]):
            raise ValueError('invalid ID3v2 header')
        size = 0
        for value in data[6:10]: size = (size << 7) | value
        start = 10 + size + (10 if data[3] == 4 and data[5] & 0x10 else 0)
        if start > end: raise ValueError('truncated ID3v2 tag')
    if end - start >= 128 and data[end-128:end-125] == b'TAG': end -= 128
    rates = (44100, 48000, 32000)
    bitrates_v1 = (0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320)
    bitrates_v2 = (0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160)
    frames, samples, first_rate, first_channels = 0, 0, None, None
    position = start
    while position < end:
        if position + 4 > end: raise ValueError('truncated MP3 frame header')
        header = int.from_bytes(data[position:position+4], 'big')
        version, layer = (header >> 19) & 3, (header >> 17) & 3
        bitrate_index, rate_index, padding = (header >> 12) & 15, (header >> 10) & 3, (header >> 9) & 1
        if header >> 21 != 0x7ff or version == 1 or layer != 1 or bitrate_index in (0, 15) or rate_index == 3:
            raise ValueError('unsupported or invalid MP3 frame header')
        rate = rates[rate_index] // ({3: 1, 2: 2, 0: 4}[version])
        bitrate = (bitrates_v1 if version == 3 else bitrates_v2)[bitrate_index] * 1000
        length = (144 if version == 3 else 72) * bitrate // rate + padding
        if length < 4 or position + length > end: raise ValueError('truncated MP3 frame')
        channels = 1 if (header >> 6) & 3 == 3 else 2
        if first_rate is None: first_rate, first_channels = rate, channels
        elif rate != first_rate or channels != first_channels: raise ValueError('MP3 changes sample rate or channel count')
        frames += 1
        samples += 1152 if version == 3 else 576
        position += length
    if not frames: raise ValueError('empty MP3 stream')
    return {'format': 'mp3', 'channels': first_channels, 'sample_rate': first_rate, 'frames': frames,
            'duration_seconds': samples / first_rate, 'duration_estimated': True,
            'validation': 'MPEG Layer III frame structure; audio not decoded'}


def _ogg_table():
    result = []
    for byte in range(256):
        value = byte << 24
        for _ in range(8): value = ((value << 1) ^ (0x04c11db7 if value & 0x80000000 else 0)) & 0xffffffff
        result.append(value)
    return result


OGG_CRC = _ogg_table()


def inspect_ogg_vorbis(data):
    position, serial, sequence, continued, eos = 0, None, None, False, False
    packet, packets, page_count, final_granule = bytearray(), [], 0, None
    while position < len(data):
        if eos or position + 27 > len(data) or data[position:position+4] != b'OggS' or data[position+4] != 0:
            raise ValueError('invalid Ogg page header')
        flags, granule, current_serial, current_sequence, checksum, count = struct.unpack_from('<BQIIIB', data, position + 5)
        if flags & ~7 or bool(flags & 1) != continued: raise ValueError('invalid Ogg packet continuation')
        if serial is None:
            if not flags & 2 or current_sequence != 0: raise ValueError('Ogg stream does not start at beginning')
            serial, sequence = current_serial, 0
        elif current_serial != serial or current_sequence != sequence + 1 or flags & 2:
            raise ValueError('unsupported chained or discontinuous Ogg stream')
        sequence = current_sequence
        header_end = position + 27 + count
        if header_end > len(data): raise ValueError('truncated Ogg segment table')
        lacing = data[position+27:header_end]
        end = header_end + sum(lacing)
        if end > len(data): raise ValueError('truncated Ogg page')
        crc = 0
        for offset in range(position, end):
            byte = 0 if position + 22 <= offset < position + 26 else data[offset]
            crc = ((crc << 8) & 0xffffffff) ^ OGG_CRC[((crc >> 24) ^ byte) & 0xff]
        if crc != checksum: raise ValueError('Ogg page checksum mismatch')
        cursor = header_end
        for length in lacing:
            if len(packets) < 3: packet.extend(data[cursor:cursor+length])
            cursor += length
            continued = length == 255
            if not continued and len(packets) < 3:
                packets.append(bytes(packet)); packet.clear()
        if granule != 0xffffffffffffffff: final_granule = granule
        eos = bool(flags & 4)
        position = end
        page_count += 1
    if not eos or continued or len(packets) < 3: raise ValueError('incomplete Ogg Vorbis stream')
    if not all(packet.startswith(prefix) for packet, prefix in zip(packets, (b'\x01vorbis', b'\x03vorbis', b'\x05vorbis'))):
        raise ValueError('unsupported Ogg codec or invalid Vorbis headers')
    first = packets[0]
    if len(first) < 30 or struct.unpack_from('<I', first, 7)[0] != 0: raise ValueError('invalid Vorbis identification header')
    channels, rate = first[11], struct.unpack_from('<I', first, 12)[0]
    if not channels or not rate or not first[29] & 1: raise ValueError('invalid Vorbis audio parameters')
    return {'format': 'ogg-vorbis', 'channels': channels, 'sample_rate': rate, 'pages': page_count,
            'duration_seconds': final_granule / rate if final_granule is not None else None,
            'validation': 'Ogg page checksums and Vorbis headers; audio not decoded'}
