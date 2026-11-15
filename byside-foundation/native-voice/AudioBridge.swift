import Foundation
import AVFoundation
import CoreAudio

// The bridge speaks newline-delimited JSON on stdio; it never sees provider credentials.
let outputQueue = DispatchQueue(label: "com.byside.audio.output")
func emit(_ event: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: event),
          let line = String(data: data, encoding: .utf8) else { return }
    outputQueue.async {
        if let bytes = (line + "\n").data(using: .utf8) {
            FileHandle.standardOutput.write(bytes)
        }
    }
}

func defaultDevice(_ selector: AudioObjectPropertySelector) -> [String: Any] {
    var address = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var id = AudioDeviceID(0)
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &id)
    guard status == noErr, id != 0 else { return ["available": false] }
    return ["available": true, "id": id]
}

if CommandLine.arguments.contains("--probe") {
    let data: [String: Any] = ["input": defaultDevice(kAudioHardwarePropertyDefaultInputDevice), "output": defaultDevice(kAudioHardwarePropertyDefaultOutputDevice)]
    let bytes = try JSONSerialization.data(withJSONObject: data, options: [.sortedKeys])
    print(String(decoding: bytes, as: UTF8.self))
    exit(0)
}

let authorization = AVCaptureDevice.authorizationStatus(for: .audio)
if authorization == .notDetermined {
    let decision = DispatchSemaphore(value: 0)
    AVCaptureDevice.requestAccess(for: .audio) { _ in decision.signal() }
    if decision.wait(timeout: .now() + 120) == .timedOut {
        emit(["type": "error", "message": "等待麦克风权限超时，请允许系统访问麦克风后重试。"])
        outputQueue.sync {}; exit(1)
    }
}
if AVCaptureDevice.authorizationStatus(for: .audio) != .authorized {
    emit(["type": "error", "message": "麦克风权限被拒绝，请在 macOS 系统设置的隐私与安全性中允许本机语音使用麦克风。"])
    outputQueue.sync {}; exit(1)
}

let engine = AVAudioEngine()
let player = AVAudioPlayerNode()
let input = engine.inputNode
let inputFormat = input.outputFormat(forBus: 0)
guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0,
      let captureFormat = AVAudioFormat(standardFormatWithSampleRate: 16000, channels: 1),
      let playbackFormat = AVAudioFormat(standardFormatWithSampleRate: 24000, channels: 1),
      let converter = AVAudioConverter(from: inputFormat, to: captureFormat) else {
    emit(["type": "error", "message": "无法打开默认麦克风，请检查系统声音输入设备。"])
    outputQueue.sync {}; exit(1)
}
engine.attach(player)
engine.connect(player, to: engine.mainMixerNode, format: playbackFormat)
input.installTap(onBus: 0, bufferSize: 1024, format: inputFormat) { buffer, _ in
    let capacity = AVAudioFrameCount(ceil(Double(buffer.frameLength) * 16000.0 / inputFormat.sampleRate) + 128)
    guard let converted = AVAudioPCMBuffer(pcmFormat: captureFormat, frameCapacity: capacity) else { return }
    var provided = false
    var conversionError: NSError?
    _ = converter.convert(to: converted, error: &conversionError) { _, status in
        if provided { status.pointee = .noDataNow; return nil }
        provided = true; status.pointee = .haveData; return buffer
    }
    guard conversionError == nil, let samples = converted.floatChannelData?[0], converted.frameLength > 0 else { return }
    var pcm = Data(capacity: Int(converted.frameLength) * 2)
    for i in 0..<Int(converted.frameLength) {
        let sample = max(-1.0, min(1.0, samples[i]))
        var value = Int16(sample < 0 ? sample * 32768 : sample * 32767).littleEndian
        withUnsafeBytes(of: &value) { pcm.append(contentsOf: $0) }
    }
    emit(["type": "capture", "audio": pcm.base64EncodedString()])
}

do {
    try engine.start()
    player.play()
    emit(["type": "ready", "protocolVersion": "1.0",
          "input": ["encoding": "pcm_s16le", "rate": 16000, "channels": 1],
          "output": ["encoding": "pcm_s16le", "rate": 24000, "channels": 1]])
} catch {
    input.removeTap(onBus: 0)
    emit(["type": "error", "message": "无法启动本机音频设备，请检查系统默认麦克风和扬声器。"])
    outputQueue.sync {}; exit(1)
}

let observer = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil) { _ in
    emit(["type": "error", "message": "系统音频设备发生变化，请重新启动本机语音。"])
}

while let line = readLine() {
    guard let raw = line.data(using: .utf8),
          let message = (try? JSONSerialization.jsonObject(with: raw)) as? [String: Any],
          let type = message["type"] as? String else { continue }
    if type == "stop" { break }
    if type == "flush" { player.stop(); player.play(); continue }
    if type == "play", let encoded = message["audio"] as? String,
       let bytes = Data(base64Encoded: encoded), bytes.count > 0, bytes.count % 2 == 0,
       let id = message["id"] as? Int,
       let buffer = AVAudioPCMBuffer(pcmFormat: playbackFormat, frameCapacity: AVAudioFrameCount(bytes.count / 2)),
       let samples = buffer.floatChannelData?[0] {
        buffer.frameLength = AVAudioFrameCount(bytes.count / 2)
        bytes.withUnsafeBytes { rawBytes in
            let inputBytes = rawBytes.bindMemory(to: UInt8.self)
            for i in 0..<Int(buffer.frameLength) {
                let bits = UInt16(inputBytes[2 * i]) | (UInt16(inputBytes[2 * i + 1]) << 8)
                samples[i] = Float(Int16(bitPattern: bits)) / 32768.0
            }
        }
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { _ in emit(["type": "played", "id": id]) }
    }
}

NotificationCenter.default.removeObserver(observer)
input.removeTap(onBus: 0)
player.stop()
engine.stop()
outputQueue.sync {}
