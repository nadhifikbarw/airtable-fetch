import type { RetryDelayOption } from "./retry";
import type {
  CreateAirtableFetchOptions,
  AirtableOptions,
  CustomHeaders,
  UserInfo,
} from "./types";
import type { FetchResponse } from "ofetch";

import { defu } from "defu";
import { ofetch } from "ofetch";
import { createRetryDelayFn } from "./retry";
import { AirtableError } from "./error";
import { AirtableBase } from "./base";

export class Airtable {
  readonly apiKey: string;
  readonly apiVersion: string;
  readonly apiVersionMajor: string;
  readonly customHeaders: CustomHeaders | undefined;
  readonly endpointUrl: string;
  readonly noRetryIfRateLimited: boolean | RetryDelayOption;
  readonly requestTimeout: number;

  readonly $fetch: typeof ofetch;

  constructor(opts: AirtableOptions) {
    const $opts = defu(opts, {
      endpointURL:
        process.env.AIRTABLE_ENDPOINT_URL || "https://api.airtable.com",
      apiVersion: "0.1.0",
      apiKey: process.env.AIRTABLE_API_KEY,
      noRetryIfRateLimited: false,
      requestTimeout: 300 * 1000, // $ minutes
    } satisfies AirtableOptions);
    if (!$opts.apiKey) {
      throw new Error("An API key is required to connect to Airtable");
    }

    this.apiKey = $opts.apiKey.trim();
    this.endpointUrl = $opts.endpointURL;
    this.apiVersion = $opts.apiVersion;
    this.apiVersionMajor = $opts.apiVersion.split(".")[0];
    this.noRetryIfRateLimited = $opts.noRetryIfRateLimited;
    this.requestTimeout = $opts.requestTimeout;
    this.customHeaders = $opts.customHeaders;

    const retryDelayFn =
      typeof this.noRetryIfRateLimited === "boolean"
        ? this.noRetryIfRateLimited
          ? createRetryDelayFn()
          : 0
        : createRetryDelayFn(this.noRetryIfRateLimited);

    const retryStatusCodes = [429];

    this.$fetch = ofetch.create({
      baseURL: this.endpointUrl,
      headers: {
        Authorization: "Bearer " + this.apiKey,
        ...this.customHeaders,
      },
      // Perform automatic retry until timeout reached
      retry: this.noRetryIfRateLimited === true ? false : Infinity,
      timeout: this.requestTimeout,
      retryDelay: retryDelayFn,
      retryStatusCodes,
      onRequestError(ctx) {
        throw new AirtableError("CONNECTION_ERROR", ctx.error.message);
      },
      // onResponseError() always getting called before ofetch native hook
      // to handle feature such as retry and timeout, make sure to pass
      // through such scenario when maintaining response error hook!
      onResponseError(ctx) {
        const response = ctx.response as FetchResponse<{
          type?: string;
          message?: string;
        }>;
        const statusCode = response.status;

        // If retry allowed, pass through retry status codes
        if (retryDelayFn !== 0 && retryStatusCodes.includes(statusCode)) return;

        const hasBody = response._data !== undefined;
        const { type, message } = response._data ?? {};

        switch (statusCode) {
          case 401: {
            throw new AirtableError(
              "AUTHENTICATION_REQUIRED",
              "You should provide valid api key to perform this operation",
              response
            );
          }
          case 403: {
            throw new AirtableError(
              "NOT_AUTHORIZED",
              "You are not authorized to perform this operation",
              response
            );
          }
          case 404: {
            throw new AirtableError(
              "NOT_FOUND",
              message ?? "Could not find what you are looking for",
              response
            );
          }
          case 413: {
            throw new AirtableError(
              "REQUEST_TOO_LARGE",
              "Request body is too large",
              response
            );
          }
          case 422: {
            throw new AirtableError(
              type ?? "UNPROCESSABLE_ENTITY",
              message ?? "The operation cannot be processed",
              response
            );
          }
          case 429: {
            throw new AirtableError(
              "TOO_MANY_REQUESTS",
              "You have made too many requests in a short period of time. Please retry your request later",
              response
            );
          }
          case 500: {
            throw new AirtableError(
              "SERVER_ERROR",
              "Try again. If the problem persists, contact support.",
              response
            );
          }
          case 503: {
            throw new AirtableError(
              "SERVICE_UNAVAILABLE",
              "The service is temporarily unavailable. Please retry shortly.",
              response
            );
          }
          default: {
            throw new AirtableError(
              type ?? "UNEXPECTED_ERROR",
              (message ?? hasBody)
                ? "An unexpected error occurred"
                : "The response from Airtable was invalid JSON. Please try again soon.",
              response
            );
          }
        }
      },
    });
  }

  // async $fetchPaginate<T = any>(
  //   request: RequestInit,
  //   opts: FetchPaginateOptions
  // ) {
  //   const ctx = request;
  //   while (true) {
  //     const response = await this.$fetch<T>(request as Request);
  //
  //     // Handle first page?
  //
  //     // Support each page?
  //
  //     // Check offset field
  //
  //     // Call hook
  //   }
  //   // Do fetch
  //   // Check if it has offset
  // }

  // async $fetchFirst() {
  //
  // }

  create(
    opts: AirtableOptions,
    fetchOptions?: CreateAirtableFetchOptions
  ): Airtable {
    const $fetchOptions = {
      headers: "resolve",
      ...fetchOptions,
    } satisfies CreateAirtableFetchOptions;

    const $opts = defu(opts, {
      endpointURL: this.endpointUrl,
      apiVersion: this.apiVersion,
      apiKey: this.apiKey,
      noRetryIfRateLimited: this.noRetryIfRateLimited,
      requestTimeout: this.requestTimeout,
      customHeaders:
        $fetchOptions.headers === "resolve" ? this.customHeaders : undefined,
    } satisfies AirtableOptions);

    if ($fetchOptions.headers === "replace")
      $opts.customHeaders = opts.customHeaders;

    const newAirtable = new Airtable($opts as AirtableOptions);
    return newAirtable;
  }

  base(baseId: string) {
    return new AirtableBase(this, baseId);
  }

  async whoami(): Promise<UserInfo> {
    const data = await this.$fetch<UserInfo>("/meta/whoami");
    return { id: data.id, email: data.email, scopes: data.scopes };
  }

  // async bases(): Promise<BaseInfo[]> {
  //   const data =
  // }
}
