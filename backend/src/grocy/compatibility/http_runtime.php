<?php

function nativeHttpIni(): array
{
    $settings = [];
    foreach (['display_errors', 'html_errors', 'error_prepend_string', 'error_append_string',
        'docref_root', 'docref_ext', 'default_mimetype', 'default_charset',
        'log_errors', 'error_log', 'ignore_repeated_errors', 'ignore_repeated_source'] as $name) {
        $settings[$name] = base64_encode(ini_get($name));
    }
    return $settings;
}

function nativeApplyHttpIni(array $settings): void
{
    foreach ($settings as $name => $value) ini_set($name, base64_decode($value, true));
}
