package com.byside.exception;

import org.springframework.http.HttpStatus;

import lombok.Getter;

@Getter
public class LlmException extends RuntimeException {

    private final HttpStatus status;

    public LlmException(String message, HttpStatus status) {
        super(message);
        this.status = status;
    }

    public LlmException(String message, HttpStatus status, Throwable cause) {
        super(message, cause);
        this.status = status;
    }
}
