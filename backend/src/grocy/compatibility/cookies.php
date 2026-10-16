<?php

require __DIR__ . '/http_runtime.php';

// Cookie registration belongs to PHP's HTTP SAPI, including startup warnings.
$startup = json_decode(file_get_contents('php://input'), true);
if ($startup !== null) {
    nativeApplyHttpIni($startup['ini']);
    error_reporting($startup['error_reporting']);
    for ($level = 0; $level < $startup['buffers']; $level++) ob_start();
    echo base64_decode($startup['output'] ?? '', true);
    // Grocy calls this before route handling, including when no buffer exists.
    ob_clean();
}
$cookies = base64_encode(serialize($_COOKIE));
$committed = headers_sent();
if (!$committed) header('Content-Type: application/json');
echo "\x1eGROCY_COOKIE_STATE\x1e", json_encode([
    'cookies' => $cookies,
    'committed' => $committed,
    'ini' => nativeHttpIni(),
    'error_reporting' => error_reporting(),
], JSON_THROW_ON_ERROR);
