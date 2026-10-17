package com.byside.config;

import java.time.Duration;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Data
@ConfigurationProperties(prefix = "llm")
public class LlmProperties {

    private String apiKey = "";

    private String baseUrl = "https://modelservice.jdcloud.com/v1";

    private String model = "DeepSeek-V4-Flash-0731";

    private String visionModel = "qwen3-vl-235";

    private Duration connectTimeout = Duration.ofSeconds(10);

    private Duration readTimeout = Duration.ofSeconds(120);
}
