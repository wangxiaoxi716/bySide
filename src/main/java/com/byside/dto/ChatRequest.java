package com.byside.dto;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotEmpty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ChatRequest {

    @NotEmpty(message = "messages 不能为空")
    private List<Message> messages;

    private String model;

    @JsonProperty("max_tokens")
    @Builder.Default
    private Integer maxTokens = 512;

    private Double temperature;

    @Builder.Default
    private Boolean stream = false;
}
