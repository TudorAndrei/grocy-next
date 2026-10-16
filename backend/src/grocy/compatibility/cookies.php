<?php

// Cookie registration belongs to PHP's HTTP SAPI, including startup warnings.
$cookies = base64_encode(serialize($_COOKIE));
$committed = headers_sent();
if (!$committed) header('Content-Type: application/json');
echo "\x1eGROCY_COOKIE_STATE\x1e", json_encode([
    'cookies' => $cookies,
    'committed' => $committed,
], JSON_THROW_ON_ERROR);
