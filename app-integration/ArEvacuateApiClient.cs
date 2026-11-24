using System;
using System.Collections;
using UnityEngine;
using UnityEngine.Networking;

[Serializable]
public class ArEvacuatePlace
{
    public string id;
    public string building;
    public string floor;
    public string room;
    public string kind; // room, corridor, stairs, exit; stairs means stair entrance, not evacuation complete.
    public bool hasPhoto;
    public string photoUrl;
    public string photoUpdatedAt;
}

[Serializable]
public class ArEvacuatePlaceList
{
    public int schemaVersion;
    public string generatedAt;
    public int count;
    public ArEvacuatePlace[] places;
}

// First integration step only: no AR, location tracking, or route calculations.
public class ArEvacuateApiClient : MonoBehaviour
{
    [SerializeField] private string serverBaseUrl = "http://127.0.0.1:8001";
    public event Action<ArEvacuatePlace[]> PlacesLoaded;
    public event Action<Texture2D> PhotoLoaded;
    public event Action PhotoCleared;
    public event Action<string> RequestFailed;
    public bool IsLoadingPlaces { get; private set; }
    public bool IsLoadingPhoto { get; private set; }
    private Texture2D currentPhoto;

    public void LoadPlaces()
    {
        if (!IsLoadingPlaces) StartCoroutine(FetchPlaces());
    }

    public void LoadPhoto(ArEvacuatePlace place)
    {
        if (IsLoadingPhoto) return;
        PhotoCleared?.Invoke();
        if (currentPhoto != null) { Destroy(currentPhoto); currentPhoto = null; }
        if (place == null || !place.hasPhoto || String.IsNullOrEmpty(place.photoUrl))
        {
            Fail("이 장소에 등록된 사진이 없습니다.");
            return;
        }
        StartCoroutine(FetchPhoto(place.photoUrl));
    }

    private bool TryUrl(string path, out string url)
    {
        url = null;
        Uri baseUri;
        if (!Uri.TryCreate(serverBaseUrl.TrimEnd('/') + "/", UriKind.Absolute, out baseUri) ||
            (baseUri.Scheme != "http" && baseUri.Scheme != "https"))
        {
            Fail("Inspector의 Server Base Url을 확인하세요.");
            return false;
        }
        Uri resolved;
        if (!path.StartsWith("/api/app/", StringComparison.Ordinal) ||
            !Uri.TryCreate(baseUri, path, out resolved) || resolved.Authority != baseUri.Authority)
        {
            Fail("서버가 전달한 사진/API 주소가 올바르지 않습니다.");
            return false;
        }
        url = resolved.AbsoluteUri;
        return true;
    }

    private UnityWebRequestAsyncOperation Send(UnityWebRequest request)
    {
        request.timeout = 10;
        try { return request.SendWebRequest(); }
        catch (Exception exception) { Fail(exception.Message); return null; }
    }

    private IEnumerator FetchPlaces()
    {
        string url;
        if (!TryUrl("/api/app/places", out url)) yield break;
        IsLoadingPlaces = true;
        using (UnityWebRequest request = UnityWebRequest.Get(url))
        {
            UnityWebRequestAsyncOperation operation = Send(request);
            if (operation == null) { IsLoadingPlaces = false; yield break; }
            yield return operation;
            IsLoadingPlaces = false;
            if (request.result != UnityWebRequest.Result.Success)
            {
                Fail("장소 목록 조회 실패 (" + request.responseCode + "): " + request.error);
                yield break;
            }
            ArEvacuatePlaceList result = null;
            try { result = JsonUtility.FromJson<ArEvacuatePlaceList>(request.downloadHandler.text); }
            catch (Exception exception) { Fail("JSON 해석 실패: " + exception.Message); }
            if (result == null || result.schemaVersion != 1 || result.places == null)
            {
                Fail("지원하지 않는 API 응답 형식입니다.");
                yield break;
            }
            Debug.Log("서버 장소 " + result.places.Length + "개 수신");
            PlacesLoaded?.Invoke(result.places);
        }
    }

    private IEnumerator FetchPhoto(string path)
    {
        string url;
        if (!TryUrl(path, out url)) yield break;
        IsLoadingPhoto = true;
        using (UnityWebRequest request = UnityWebRequestTexture.GetTexture(url))
        {
            UnityWebRequestAsyncOperation operation = Send(request);
            if (operation == null) { IsLoadingPhoto = false; yield break; }
            yield return operation;
            IsLoadingPhoto = false;
            if (request.result != UnityWebRequest.Result.Success)
            {
                Fail("사진 조회 실패 (" + request.responseCode + "): " + request.error);
                yield break;
            }
            currentPhoto = DownloadHandlerTexture.GetContent(request);
            PhotoLoaded?.Invoke(currentPhoto);
        }
    }

    private void Fail(string message)
    {
        Debug.LogWarning(message);
        RequestFailed?.Invoke(message);
    }

    private void OnDestroy()
    {
        if (currentPhoto != null) Destroy(currentPhoto);
    }
}
