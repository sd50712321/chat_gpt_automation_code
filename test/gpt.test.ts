import { ChatCompletionRequestMessage, OpenAIApi } from "openai";
import { createChatCompletionWithRetry } from "../index";
jest.mock("openai", () => {
  return {
    createChatCompletion: jest.fn(),
    OpenAIApi: jest.fn(),
  };
});

// 테스트용 OpenAIApi 인스턴스를 생성합니다.
describe("createChatCompletionWithRetry()", () => {
  const openAiMock = new OpenAIApi();
  afterEach(() => {
    jest.clearAllMocks();
  });

  test("테스트 1 - 정상 호출", async () => {
    // OpenAIApi.createChatCompletion() 메서드를 모의(mock)하여 응답을 설정합니다.
    const expectedResponse = { data: { completion: "안녕하세요" } };
    openAiMock.createChatCompletion.mockResolvedValueOnce(expectedResponse);

    // createChatCompletionWithRetry() 함수를 호출합니다.
    const messages: ChatCompletionRequestMessage[] = [
      { role: "user", content: "test" },
    ];
    const temperature = 0.5;
    const response = await createChatCompletionWithRetry(
      messages,
      temperature,
      openAiMock
    );

    // OpenAIApi.createChatCompletion() 메서드가 한 번 호출되었는지 확인합니다.
    expect(openAiMock.createChatCompletion).toHaveBeenCalledTimes(1);

    // OpenAIApi.createChatCompletion() 메서드가 호출될 때 인자들을 확인합니다.
    expect(openAiMock.createChatCompletion).toHaveBeenCalledWith(
      {
        model: "gpt-3.5-turbo",
        messages: messages,
        temperature: temperature,
      },
      {
        timeout: 120000 * 1,
        maxBodyLength: 8192 * 40,
      }
    );

    // createChatCompletionWithRetry() 함수가 응답한 결과값을 확인합니다.
    expect(response).toEqual(expectedResponse);
  });

  test("테스트 2 - 시간초과 다섯 번 발생", async () => {
    // createChatCompletionWithRetry() 함수가 throw하는 에러를 설정합니다.
    const error = new Error("timeout");
    error.message = "timeout";
    openAiMock.createChatCompletion.mockRejectedValueOnce(error);

    // createChatCompletionWithRetry() 함수를 호출합니다.
    const messages: ChatCompletionRequestMessage[] = [
      { role: "user", content: "test" },
    ];
    const temperature = 0.5;
    await expect(
      createChatCompletionWithRetry(messages, temperature, openAiMock)
    ).rejects.toThrow();

    // OpenAIApi.createChatCompletion() 메서드가 다섯 번 호출되었는지 확인합니다.
    expect(openAiMock.createChatCompletion).toHaveBeenCalledTimes(5);

    // OpenAIApi.createChatCompletion() 메서드가 호출될 때 인자들을 확인합니다.
    expect(openAiMock.createChatCompletion).toHaveBeenCalledWith(
      {
        model: "gpt-3.5-turbo",
        messages: messages,
        temperature: temperature,
      },
      {
        timeout: 120000 * 1,
        maxBodyLength: 8192 * 40,
      }
    );
  });

  test("테스트 3 - 에러 발생", async () => {
    // createChatCompletionWithRetry() 함수가 throw하는 에러를 설정합니다.
    const error = new Error("mock error");
    openAiMock.createChatCompletion.mockRejectedValueOnce(error);

    // createChatCompletionWithRetry() 함수를 호출합니다.
    const messages: ChatCompletionRequestMessage[] = [
      { role: "user", content: "test" },
    ];
    const temperature = 0.5;
    await expect(
      createChatCompletionWithRetry(messages, temperature, openAiMock)
    ).rejects.toThrow();

    // OpenAIApi.createChatCompletion() 메서드가 한 번 호출되었는지 확인합니다.
    expect(openAiMock.createChatCompletion).toHaveBeenCalledTimes(1);

    // OpenAIApi.createChatCompletion() 메서드가 호출될 때 인자들을 확인합니다.
    expect(openAiMock.createChatCompletion).toHaveBeenCalledWith(
      {
        model: "gpt-3.5-turbo",
        messages: messages,
        temperature: temperature,
      },
      {
        timeout: 120000 * 1,
        maxBodyLength: 8192 * 40,
      }
    );
  });
});
