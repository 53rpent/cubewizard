"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRuntimeConfig = void 0;
const httpAuthSchemes_1 = require("@aws-sdk/core/httpAuthSchemes");
const middleware_sdk_s3_1 = require("@aws-sdk/middleware-sdk-s3");
const signature_v4_multi_region_1 = require("@aws-sdk/signature-v4-multi-region");
const client_1 = require("@smithy/core/client");
const protocols_1 = require("@smithy/core/protocols");
const serde_1 = require("@smithy/core/serde");
const httpAuthSchemeProvider_1 = require("./auth/httpAuthSchemeProvider");
const endpointResolver_1 = require("./endpoint/endpointResolver");
const schemas_0_1 = require("./schemas/schemas_0");
const getRuntimeConfig = (config) => {
    return {
        apiVersion: "2006-03-01",
        base64Decoder: config?.base64Decoder ?? serde_1.fromBase64,
        base64Encoder: config?.base64Encoder ?? serde_1.toBase64,
        disableHostPrefix: config?.disableHostPrefix ?? false,
        endpointProvider: config?.endpointProvider ?? endpointResolver_1.defaultEndpointResolver,
        extensions: config?.extensions ?? [],
        getAwsChunkedEncodingStream: config?.getAwsChunkedEncodingStream ?? serde_1.getAwsChunkedEncodingStream,
        httpAuthSchemeProvider: config?.httpAuthSchemeProvider ?? httpAuthSchemeProvider_1.defaultS3HttpAuthSchemeProvider,
        httpAuthSchemes: config?.httpAuthSchemes ?? [
            {
                schemeId: "aws.auth#sigv4",
                identityProvider: (ipc) => ipc.getIdentityProvider("aws.auth#sigv4"),
                signer: new httpAuthSchemes_1.AwsSdkSigV4Signer(),
            },
            {
                schemeId: "aws.auth#sigv4a",
                identityProvider: (ipc) => ipc.getIdentityProvider("aws.auth#sigv4a"),
                signer: new httpAuthSchemes_1.AwsSdkSigV4ASigner(),
            },
        ],
        logger: config?.logger ?? new client_1.NoOpLogger(),
        protocol: config?.protocol ?? middleware_sdk_s3_1.S3RestXmlProtocol,
        protocolSettings: config?.protocolSettings ?? {
            defaultNamespace: "com.amazonaws.s3",
            errorTypeRegistries: schemas_0_1.errorTypeRegistries,
            xmlNamespace: "http://s3.amazonaws.com/doc/2006-03-01/",
            version: "2006-03-01",
            serviceTarget: "AmazonS3",
        },
        sdkStreamMixin: config?.sdkStreamMixin ?? serde_1.sdkStreamMixin,
        serviceId: config?.serviceId ?? "S3",
        signerConstructor: config?.signerConstructor ?? signature_v4_multi_region_1.SignatureV4MultiRegion,
        signingEscapePath: config?.signingEscapePath ?? false,
        urlParser: config?.urlParser ?? protocols_1.parseUrl,
        useArnRegion: config?.useArnRegion ?? undefined,
        utf8Decoder: config?.utf8Decoder ?? serde_1.fromUtf8,
        utf8Encoder: config?.utf8Encoder ?? serde_1.toUtf8,
    };
};
exports.getRuntimeConfig = getRuntimeConfig;
